import { Keypair, PublicKey } from '@solana/web3.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A Solana-sourced LI.FI route whose destination is on another chain (here
// Arbitrum) must not go through the Solana destination-ATA injection: the
// destination token is an EVM contract and the recipient an EVM address, so
// decoding either as a Solana public key throws "Non-base58 character" and
// kills an otherwise valid route. A Solana -> Solana SPL route must still run
// the injection.

const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
// Synthetic wallets: a fresh keypair for the Solana side, a placeholder for EVM.
const SOLANA_SOURCE = Keypair.generate().publicKey.toBase58()
const EVM_DESTINATION = '0x1111111111111111111111111111111111111111'
const LIFI_SOLANA_CHAIN_ID = 1151111081099710

const getQuoteMock = vi.hoisted(() => vi.fn())
const getAccountInfoMock = vi.hoisted(() => vi.fn())

vi.mock('@lifi/sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@lifi/sdk')>()),
  createClient: () => ({ config: {}, providers: [] }),
  getQuote: getQuoteMock,
}))

// No RPC in unit tests. `getAccountInfo` is a bare mock that resolves to
// undefined. In the cross-chain case it must never be called: if the ATA path
// is reached, decoding the EVM mint as a PublicKey throws before any RPC call.
// The SPL case relies on the undefined mint lookup to stop the injection right
// after it is reached ("Mint account … not found").
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({ getAccountInfo: getAccountInfoMock, getAddressLookupTable: vi.fn() }),
}))

const { getLifiSwapQuote } = await import('./getLifiSwapQuote')

const lifiQuote = () => ({
  transactionRequest: { data: 'serialized-solana-transaction' },
  estimate: {
    toAmount: '99450000',
    gasCosts: [{ amount: '5000' }],
    feeCosts: [
      {
        name: 'LIFI Fixed Fee',
        amount: '250000',
        feeSplit: { integratorFee: '0', lifiFee: '250000' },
        token: { address: SOLANA_USDC, chainId: LIFI_SOLANA_CHAIN_ID, decimals: 6 },
      },
    ],
  },
})

describe('getLifiSwapQuote — Solana destination-ATA injection gate', () => {
  beforeEach(() => {
    getQuoteMock.mockReset()
    getAccountInfoMock.mockReset()
    getQuoteMock.mockResolvedValue(lifiQuote())
  })

  it('quotes Solana USDC -> Arbitrum USDC without decoding EVM addresses as base58', async () => {
    const quote = await getLifiSwapQuote({
      from: { chain: Chain.Solana, id: SOLANA_USDC, address: SOLANA_SOURCE, ticker: 'USDC' },
      to: { chain: Chain.Arbitrum, id: ARBITRUM_USDC, address: EVM_DESTINATION, ticker: 'USDC' },
      amount: 100_000_000n,
      affiliateBps: 50,
    })

    expect(getQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fromChain: LIFI_SOLANA_CHAIN_ID,
        toChain: 42161,
        fromToken: SOLANA_USDC,
        toToken: ARBITRUM_USDC,
        fromAddress: SOLANA_SOURCE,
        toAddress: EVM_DESTINATION,
      })
    )
    // The cross-chain route is returned untouched — no ATA lookup on Solana.
    expect(getAccountInfoMock).not.toHaveBeenCalled()
    expect(quote.dstAmount).toBe('99450000')
    expect(quote.provider).toBe('li.fi')
    expect(quote.tx).toMatchObject({
      solana: { data: 'serialized-solana-transaction', networkFee: 5000n },
    })
  })

  it('still runs the destination-ATA injection for a Solana -> Solana SPL route', async () => {
    await expect(
      getLifiSwapQuote({
        from: { chain: Chain.Solana, address: SOLANA_SOURCE, ticker: 'SOL' },
        to: { chain: Chain.Solana, id: SOLANA_USDC, address: SOLANA_SOURCE, ticker: 'USDC' },
        amount: 1_000_000_000n,
        affiliateBps: 50,
      })
    ).rejects.toThrow(`Mint account ${SOLANA_USDC} not found`)

    expect(getAccountInfoMock).toHaveBeenCalledWith(new PublicKey(SOLANA_USDC))
  })
})
