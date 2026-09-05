import { Chain } from '@vultisig/core-chain/Chain'
import { scanAddressWithBlockaid } from '@vultisig/core-chain/security/blockaid/address'
import { configureSwapKit, getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import type { SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import {
  SwapKitAmountBelowMinimumError,
  SwapKitNoEligibleRoutesError,
} from '@vultisig/core-chain/swap/general/swapkit/SwapKitErrors'
import { resetSwapKitProvidersCache } from '@vultisig/core-chain/swap/general/swapkit/SwapKitProviders'
import { networks, payments, Psbt } from 'bitcoinjs-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))

const mockScanAddressWithBlockaid = vi.mocked(scanAddressWithBlockaid)

const response = (body: unknown, ok = true, status = 200) => {
  const serialized = JSON.stringify(body)
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    text: vi.fn(async () => serialized),
    json: vi.fn(async () => body),
  } as unknown as Response
}

const textEncoder = new TextEncoder()
const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const BTC_RECIPIENT_ADDRESS = 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'
const EVM_TARGET_ADDRESS = '0x111111125421ca6dc452d289314280a0f8842a65'

const makeBitcoinPsbtPayload = (outputValue: bigint) => {
  const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
  const psbt = new Psbt({ network: networks.bitcoin })

  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 110_000n },
  })
  psbt.addOutput({ address: BTC_RECIPIENT_ADDRESS, value: outputValue })

  return { sourceAddress: p2wpkh.address!, targetAddress: BTC_RECIPIENT_ADDRESS, payload: psbt.toBuffer() }
}

type TransferSourceFixture = readonly [string, SwapKitSourceChain, string, number, string, string]

const transferSourceFixtures: TransferSourceFixture[] = [
  ['Litecoin', Chain.Litecoin, 'LTC', 8, 'ltc1qsource', 'Ldeposit'],
  ['Dogecoin', Chain.Dogecoin, 'DOGE', 8, 'Dsource', 'Ddeposit'],
  ['Bitcoin Cash', Chain.BitcoinCash, 'BCH', 8, 'bitcoincash:qsource', 'bitcoincash:qdeposit'],
  ['Ripple', Chain.Ripple, 'XRP', 6, 'rSource', 'rDeposit'],
  ['Zcash', Chain.Zcash, 'ZEC', 8, 't1Source', 't1Deposit'],
  ['Tron', Chain.Tron, 'TRX', 6, 'TSource', 'TDeposit'],
  ['TON', Chain.Ton, 'TON', 9, 'UQSource', 'UQDeposit'],
]

describe('getSwapKitQuote', () => {
  beforeEach(() => {
    resetSwapKitProvidersCache()
    mockScanAddressWithBlockaid.mockReset()
    mockScanAddressWithBlockaid.mockResolvedValue({ resultType: 'Benign', features: ['trusted'] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })
  })

  const evmQuoteResponse = () =>
    response({ routes: [{ routeId: 'catalog-route', providers: ['FLASHNET'], expectedBuyAmount: '1' }] })

  const evmSwapResponse = () =>
    response({
      expectedBuyAmount: '1',
      providers: ['FLASHNET'],
      targetAddress: EVM_TARGET_ADDRESS,
      tx: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
    })

  const stubStaticEvmRoute = () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(evmQuoteResponse()).mockResolvedValueOnce(evmSwapResponse())
    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ baseUrl: 'https://swapkit.example' })

    return fetchMock
  }

  const stubCatalogEvmRoute = ({ providerChainId, assetPrefix }: { providerChainId: string; assetPrefix: string }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([{ provider: 'FLASHNET', supportedChainIds: [providerChainId] }]))
      .mockResolvedValueOnce(
        response({ provider: 'FLASHNET', tokens: [{ chain: assetPrefix, chainId: providerChainId }] })
      )
      .mockResolvedValueOnce(evmQuoteResponse())
      .mockResolvedValueOnce(evmSwapResponse())

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ baseUrl: 'https://swapkit.example' })

    return fetchMock
  }

  it('quotes a HyperEVM source with the live-confirmed HYPEREVM/999 identifiers', async () => {
    const fetchMock = stubStaticEvmRoute()

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Hyperliquid, address: '0xsender', ticker: 'HYPE', decimals: 18 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000_000_000_000_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      sellAsset: 'HYPEREVM.HYPE',
      buyAsset: 'ETH.ETH',
    })
    expect(quote.provider).toBe('swapkit')
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(EVM_TARGET_ADDRESS, 'hyperevm')
  })

  it('quotes Robinhood as a destination with the live-confirmed HOOD/4663 identifiers', async () => {
    const fetchMock = stubStaticEvmRoute()

    await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Robinhood, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000_000_000_000_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      sellAsset: 'ETH.ETH',
      buyAsset: 'HOOD.ETH',
    })
  })

  it('rejects Robinhood as a source before any catalog or quote request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Robinhood, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_000_000_000_000_000_000n,
      })
    ).rejects.toThrow('unavailable without safe signing and Blockaid coverage')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('quotes a catalog-recognized EVM destination without a SwapKit enabled-list row', async () => {
    const fetchMock = stubCatalogEvmRoute({ providerChainId: '81457', assetPrefix: 'BLAST' })

    await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Blast, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000_000_000_000_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[2][1].body).buyAsset).toBe('BLAST.ETH')
  })

  it('quotes and builds an EVM transaction while filtering native THOR/Maya routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            { routeId: 'thor-route', providers: ['THORCHAIN'], expectedBuyAmount: '15' },
            { routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '12.5' },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['NEAR'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Solana, address: 'sol-destination', ticker: 'USDC', id: 'sol-usdc-mint', decimals: 6 },
      amount: 10_000_000_000_000_000n,
      affiliateBps: 15,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const quoteBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('https://swapkit.example/v3/quote')
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('test-key')
    expect(quoteBody).toMatchObject({
      sellAsset: 'ETH.ETH',
      buyAsset: 'SOL.USDC-sol-usdc-mint',
      sellAmount: '0.01',
      affiliateFee: 15,
    })
    expect(quoteBody.sourceAddress).toBeUndefined()
    expect(quoteBody.destinationAddress).toBeUndefined()
    expect(quoteBody.providers).not.toContain('THORCHAIN')
    expect(quoteBody.providers).not.toContain('MAYACHAIN')

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      routeId: 'near-route',
      sourceAddress: '0xsender',
      destinationAddress: 'sol-destination',
      disableBalanceCheck: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).disableBuildTx).toBeUndefined()
    expect(quote).toEqual({
      dstAmount: '12400000',
      provider: 'swapkit',
      routeProvider: 'NEAR',
      tx: { evm: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xabcdef', value: '0', gasLimit: 21000n } },
    })
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(EVM_TARGET_ADDRESS, 'ethereum')
  })

  it.each(transferSourceFixtures)(
    'maps %s source routes to a transfer tx and asks SwapKit not to build a tx',
    async (_, chain, ticker, decimals, source, target) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'near-transfer-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }] })
        )
        .mockResolvedValueOnce(response({ expectedBuyAmount: '0.009', providers: ['NEAR'], targetAddress: target }))

      vi.stubGlobal('fetch', fetchMock)
      configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

      const quote = await getSwapKitQuote({
        from: { chain, address: source, ticker, decimals },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 100_000n,
      })

      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
        routeId: 'near-transfer-route',
        sourceAddress: source,
        destinationAddress: '0xdestination',
        disableBalanceCheck: true,
        disableBuildTx: true,
      })
      expect(quote).toMatchObject({
        dstAmount: '9000000000000000',
        provider: 'swapkit',
        routeProvider: 'NEAR',
        tx: { transfer: { to: target, amount: 100_000n } },
      })
    }
  )

  const stubEvmRoute = ({ route, fees }: { route?: Record<string, unknown>; fees?: unknown[] } = {}) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [{ routeId: 'evm-route', providers: ['ONEINCH'], expectedBuyAmount: '12.4', ...route }],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['ONEINCH'],
          targetAddress: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          ...(fees ? { fees } : {}),
          tx: {
            from: '0xsender',
            to: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            data: '0xabcdef',
            value: '0',
            gas: '21000',
          },
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    return getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'USDC', id: '0xusdc', decimals: 6 },
      amount: 10_000_000_000_000_000n,
      affiliateBps: 30,
    })
  }

  it('surfaces the affiliate fee SwapKit itemizes on an EVM route', async () => {
    // Without this the aggregator route looked like it charged no swap fee at
    // all, so the consumer's fee row had nothing to show and the headline total
    // silently omitted it.
    const quote = await stubEvmRoute({
      fees: [
        { type: 'affiliate', amount: '0.04', asset: 'ETH.USDC-0xusdc', chain: 'ETH' },
        { type: 'network', amount: '0.0002', asset: 'ETH.ETH', chain: 'ETH' },
      ],
    })

    expect('evm' in quote.tx && quote.tx.evm.affiliateFee).toEqual({
      amount: 40_000n,
      chain: Chain.Ethereum,
      id: '0xusdc',
      decimals: 6,
    })
  })

  it('keeps an EVM route signable when the fee shape cannot be resolved', async () => {
    // The fee is display-only on this branch, so an unexpected asset must not
    // take down a route that would otherwise sign. Solana legitimately throws
    // here: its tx type requires the fee.
    const quote = await stubEvmRoute({
      fees: [{ type: 'affiliate', amount: '0.04', asset: 'BTC.BTC', chain: 'BTC' }],
    })

    expect('evm' in quote.tx && quote.tx.evm.to).toBe('0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1')
    expect('evm' in quote.tx && quote.tx.evm.affiliateFee).toBeUndefined()
  })

  it('leaves the affiliate fee absent when SwapKit itemizes none', async () => {
    // A zero here would render as a definite "$0.00" swap fee; staying absent
    // lets the consumer report the fee as part of the quoted rate instead.
    const quote = await stubEvmRoute()

    expect('evm' in quote.tx && quote.tx.evm.affiliateFee).toBeUndefined()
  })

  const stubTransferRoute = ({ fees }: { fees?: unknown[] } = {}) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'near-transfer-route', providers: ['NEAR'], expectedBuyAmount: '144.49' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '144.49',
          providers: ['NEAR'],
          targetAddress: 't1Deposit',
          ...(fees ? { fees } : {}),
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    return getSwapKitQuote({
      from: { chain: Chain.Zcash, address: 't1Source', ticker: 'ZEC', decimals: 8 },
      to: { chain: Chain.Tron, address: 'TDestination', ticker: 'TRX', decimals: 6 },
      amount: 9_332_136n,
    })
  }

  it('surfaces the affiliate fee SwapKit itemizes on a transfer route', async () => {
    // A transfer route reaches a cosigning peer through SwapKitSwapPayload,
    // which is the only place the fee can travel: the peer holds no quote. Left
    // off, its verify screen showed network fee alone and a total that
    // understated the swap (vultisig-windows#4362).
    const quote = await stubTransferRoute({
      fees: [
        { type: 'affiliate', amount: '0.0025', asset: 'ZEC.ZEC', chain: 'ZEC' },
        { type: 'network', amount: '0.0001', asset: 'ZEC.ZEC', chain: 'ZEC' },
      ],
    })

    expect('transfer' in quote.tx && quote.tx.transfer.swapFee).toEqual({
      amount: 250_000n,
      chain: Chain.Zcash,
      id: undefined,
      decimals: 8,
    })
  })

  it('keeps a transfer route signable when the fee shape cannot be resolved', async () => {
    // Same terms as the EVM branch: the fee is display-only here, so an
    // unexpected asset must not take down a route that would otherwise sign.
    const quote = await stubTransferRoute({
      fees: [{ type: 'affiliate', amount: '0.04', asset: 'ETH.ETH', chain: 'ETH' }],
    })

    expect('transfer' in quote.tx && quote.tx.transfer.to).toBe('t1Deposit')
    expect('transfer' in quote.tx && quote.tx.transfer.swapFee).toBeUndefined()
  })

  it.each([
    ['a bare exponent', '1e+'],
    ['a non-numeric amount', 'abc'],
  ])('keeps a transfer route signable when the fee amount is %s', async (_label, amount) => {
    // `amount` is an unvalidated string from the proxy. Parsing it throws an
    // error of its own kind, which used to escape the display-fee guard and
    // fail a route that signs perfectly well without the fee row.
    const quote = await stubTransferRoute({
      fees: [{ type: 'affiliate', amount, asset: 'ZEC.ZEC', chain: 'ZEC' }],
    })

    expect('transfer' in quote.tx && quote.tx.transfer.to).toBe('t1Deposit')
    expect('transfer' in quote.tx && quote.tx.transfer.swapFee).toBeUndefined()
  })

  it('keeps an EVM route signable when the fee amount cannot be parsed', async () => {
    const quote = await stubEvmRoute({
      fees: [{ type: 'affiliate', amount: '1e+', asset: 'ETH.USDC-0xusdc', chain: 'ETH' }],
    })

    expect('evm' in quote.tx && quote.tx.evm.to).toBe('0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1')
    expect('evm' in quote.tx && quote.tx.evm.affiliateFee).toBeUndefined()
  })

  it('leaves the transfer fee absent when SwapKit itemizes none', async () => {
    const quote = await stubTransferRoute()

    expect('transfer' in quote.tx && quote.tx.transfer.swapFee).toBeUndefined()
  })

  it('reads price impact from the route meta', async () => {
    const quote = await stubEvmRoute({ route: { meta: { priceImpact: -0.0039 }, totalSlippageBps: 120 } })

    expect(quote.priceImpactFraction).toBe(-0.0039)
  })

  it('falls back to the route slippage bps when meta omits price impact', async () => {
    const quote = await stubEvmRoute({ route: { totalSlippageBps: 133 } })

    expect(quote.priceImpactFraction).toBeCloseTo(0.0133, 10)
  })

  it('reports no price impact when the route exposes neither figure', async () => {
    const quote = await stubEvmRoute()

    expect(quote.priceImpactFraction).toBeUndefined()
  })

  it.each([
    ['an explicit null', null],
    ['a stringified number', '0.0133'],
    ['a non-finite number', Number.NaN],
  ])('falls through to the slippage bps when meta price impact is %s', async (_label, priceImpact) => {
    // Nothing validates the proxy's JSON on the way in. `null !== undefined`,
    // so an unnarrowed read would put null on a `number` field and reach the
    // consumer as `null.toFixed(...)`; a string would render 100x wrong.
    const quote = await stubEvmRoute({ route: { meta: { priceImpact }, totalSlippageBps: 133 } })

    expect(quote.priceImpactFraction).toBeCloseTo(0.0133, 10)
  })

  it('reports no price impact when neither figure is a usable number', async () => {
    const quote = await stubEvmRoute({ route: { meta: { priceImpact: null }, totalSlippageBps: '133' } })

    expect(quote.priceImpactFraction).toBeUndefined()
  })

  // PoC: can a malicious/compromised SwapKit response redirect the signed
  // destination away from what the user reviewed? Both independent trust
  // boundaries — response-local targetAddress equality, and an out-of-band
  // Blockaid reputation verdict — are exercised end to end through
  // getSwapKitQuote itself, not just against the underlying assert helpers.
  describe('quote-time destination enforcement (sdk#1458 PoC)', () => {
    const ATTACKER_ADDRESS = '0xbadbadbadbadbadbadbadbadbadbadbadbadbadb'
    const REAL_ROUTER = '0x1111111254eeb25477b68fb85ed929f73a960582'

    const stubSwapkitRoute = ({ tx, targetAddress }: { tx: Record<string, unknown>; targetAddress?: string }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'evm-route', providers: ['ONEINCH'], expectedBuyAmount: '12.4' }] })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '12.4',
            providers: ['ONEINCH'],
            ...(targetAddress ? { targetAddress } : {}),
            tx,
          })
        )

      vi.stubGlobal('fetch', fetchMock)

      return getSwapKitQuote({
        from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'USDC', id: '0xusdc', decimals: 6 },
        amount: 10_000_000_000_000_000n,
      })
    }

    it('rejects a tx.to that diverges from the screened targetAddress — a compromised response cannot redirect funds by disagreeing with itself', async () => {
      // The attacker controls tx.to but targetAddress still names the real router:
      // the two independent fields the response carries disagree, so neither one
      // alone is trustworthy.
      await expect(
        stubSwapkitRoute({
          tx: { from: '0xsender', to: ATTACKER_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
          targetAddress: REAL_ROUTER,
        })
      ).rejects.toThrow(/does not match the screened targetAddress/)
    })

    it('rejects a tx.to/targetAddress pair that agree with EACH OTHER but not with Blockaid — response-local equality alone is not destination safety', async () => {
      // The classic "smuggle via a self-consistent response" attempt: attacker
      // sets both tx.to AND targetAddress to the SAME attacker-controlled
      // address, so the response-local equality check alone would pass. The
      // independent Blockaid reputation verdict is the second boundary that
      // actually has to catch this.
      mockScanAddressWithBlockaid.mockReset()
      mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Malicious', features: ['drainer'] })

      await expect(
        stubSwapkitRoute({
          tx: { from: '0xsender', to: ATTACKER_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
          targetAddress: ATTACKER_ADDRESS,
        })
      ).rejects.toThrow(/Malicious Blockaid verdict/)

      expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(ATTACKER_ADDRESS, 'ethereum')
    })

    it('rejects a Warning Blockaid verdict on tx.to, not just Malicious', async () => {
      mockScanAddressWithBlockaid.mockReset()
      mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Warning', features: ['new_address'] })

      await expect(
        stubSwapkitRoute({
          tx: { from: '0xsender', to: REAL_ROUTER, data: '0xabcdef', value: '0', gas: '21000' },
          targetAddress: REAL_ROUTER,
        })
      ).rejects.toThrow(/Warning Blockaid verdict/)
    })

    it('fails closed at quote time when the Blockaid call itself fails — a scan we could not obtain is not evidence of safety', async () => {
      mockScanAddressWithBlockaid.mockReset()
      mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('blockaid unreachable'))

      await expect(
        stubSwapkitRoute({
          tx: { from: '0xsender', to: REAL_ROUTER, data: '0xabcdef', value: '0', gas: '21000' },
          targetAddress: REAL_ROUTER,
        })
      ).rejects.toThrow(/reputation check failed/)
    })

    it('accepts a route only once both boundaries agree it is safe (control: proves the PoC harness itself is not just always-throwing)', async () => {
      const quote = await stubSwapkitRoute({
        tx: { from: '0xsender', to: REAL_ROUTER, data: '0xabcdef', value: '0', gas: '21000' },
        targetAddress: REAL_ROUTER,
      })

      expect('evm' in quote.tx && quote.tx.evm.to).toBe(REAL_ROUTER)
    })
  })

  it('maps SwapKit transfer memo and deposit amount fallbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'deposit-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }] })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '0.009',
            providers: ['NEAR'],
            depositAddress: 'bc1qdeposit',
            depositAmount: '0.001',
            memo: 'swap-memo',
          })
        )
    )
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Bitcoin, address: 'bc1qsource', ticker: 'BTC', decimals: 8 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1n,
    })

    expect(quote.tx).toEqual({ transfer: { to: 'bc1qdeposit', amount: 100_000n, memo: 'swap-memo' } })
  })

  it('maps SwapKit transfer tx metadata into QR payload fields', async () => {
    const psbt = makeBitcoinPsbtPayload(99_999n)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'psbt-route', providers: ['CHAINFLIP'], expectedBuyAmount: '0.01' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.009',
          providers: ['CHAINFLIP'],
          targetAddress: psbt.targetAddress,
          inboundAddress: 'bc1qinbound',
          depositAmount: '0.001',
          tx: Buffer.from(psbt.payload).toString('base64'),
          meta: { txType: 'PSBT' },
          swapId: 'swapkit-id',
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Bitcoin, address: psbt.sourceAddress, ticker: 'BTC', decimals: 8 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 100_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      routeId: 'psbt-route',
      sourceAddress: psbt.sourceAddress,
      destinationAddress: '0xdestination',
      disableBalanceCheck: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).disableBuildTx).toBeUndefined()
    expect(quote.tx).toEqual({
      transfer: {
        to: psbt.targetAddress,
        amount: 99_999n,
        txType: 'PSBT',
        txPayload: psbt.payload,
        inboundAddress: 'bc1qinbound',
        swapId: 'swapkit-id',
      },
    })
  })

  it('maps transfer target and decimal amount from SwapKit tx-array fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'ton-array-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }] })
        )
        .mockResolvedValueOnce(
          response({ expectedBuyAmount: '0.009', providers: ['NEAR'], tx: [{ address: 'UQDeposit', amount: '0.001' }] })
        )
    )
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ton, address: 'UQSource', ticker: 'TON', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1n,
    })

    expect(quote.tx).toEqual({
      transfer: {
        to: 'UQDeposit',
        amount: 1_000_000n,
        txPayload: textEncoder.encode('[{"address":"UQDeposit","amount":"0.001"}]'),
      },
    })
  })

  it('maps Solana source routes to the existing serialized transaction payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'jupiter-route', providers: ['JUPITER'], expectedBuyAmount: '0.05' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'network', amount: '0.000005' },
              { type: 'service', amount: '0.000000007', asset: 'SOL.SOL', chain: 'Solana' },
            ],
          })
        )
    )
    configureSwapKit({ apiKey: 'test-key' })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000n,
    })

    expect(quote).toMatchObject({
      dstAmount: '50000000000000000',
      provider: 'swapkit',
      routeProvider: 'JUPITER',
      tx: {
        solana: {
          data: 'serialized-solana-transaction',
          networkFee: 5000n,
          swapFee: { amount: 7n, decimals: 9, chain: Chain.Solana },
        },
      },
    })
  })

  it('maps the live Chainflip streaming fee shape to destination USDC', async () => {
    const usdcId = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [
              {
                routeId: 'chainflip-streaming-route',
                providers: ['CHAINFLIP_STREAMING'],
                expectedBuyAmount: '75245.896838',
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['CHAINFLIP_STREAMING'],
            expectedBuyAmount: '75245.896838',
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'affiliate', amount: '378.691268', asset: `ETH.USDC-${usdcId}`, chain: 'Ethereum' },
              { type: 'service', amount: '113.60738', asset: `ETH.USDC-${usdcId}`, chain: 'Ethereum' },
            ],
          })
        )
    )

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'USDC', decimals: 6, id: usdcId.toLowerCase() },
      amount: 1_000_000_000_000n,
    })

    expect(quote.tx).toMatchObject({
      solana: { swapFee: { amount: 492_298_648n, decimals: 6, chain: Chain.Ethereum, id: usdcId.toLowerCase() } },
    })
  })

  it('maps independent Chainflip stable USDC fees for a SOL to native ETH route', async () => {
    const usdcId = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [
              { routeId: 'chainflip-stable-fee-route', providers: ['CHAINFLIP_STREAMING'], expectedBuyAmount: '24.5' },
            ],
          })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['CHAINFLIP_STREAMING'],
            expectedBuyAmount: '24.5',
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'affiliate', amount: '1.25', asset: `ETH.USDC-${usdcId}`, chain: 'Ethereum' },
              { type: 'service', amount: '0.5', asset: `ETH.USDC-${usdcId}`, chain: 'Ethereum' },
            ],
          })
        )
    )

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000_000_000n,
    })

    expect(quote.tx).toMatchObject({
      solana: { swapFee: { amount: 1_750_000n, decimals: 6, chain: Chain.Ethereum, id: usdcId.toLowerCase() } },
    })
  })

  it('sums repeated SwapKit fee entries of the same type and asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'repeated-fees', providers: ['JUPITER'], expectedBuyAmount: '1' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            expectedBuyAmount: '1',
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'service', amount: '0.1', asset: 'SOL.SOL' },
              { type: 'service', amount: '0.2', asset: 'SOL.SOL' },
            ],
          })
        )
    )

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000n,
    })

    expect(quote.tx).toMatchObject({ solana: { swapFee: { amount: 300_000_000n, decimals: 9, chain: Chain.Solana } } })
  })

  it('rejects a non-zero SwapKit fee without asset metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'missing-fee-asset', providers: ['JUPITER'], expectedBuyAmount: '1' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            expectedBuyAmount: '1',
            tx: 'serialized-solana-transaction',
            fees: [{ type: 'service', amount: '0.1' }],
          })
        )
    )

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_000_000n,
      })
    ).rejects.toThrow('SwapKit service fee is missing its asset.')
  })

  it('rejects affiliate and service fees denominated in different assets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'mixed-fee-assets', providers: ['JUPITER'], expectedBuyAmount: '1' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            expectedBuyAmount: '1',
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'affiliate', amount: '0.1', asset: 'SOL.SOL' },
              { type: 'service', amount: '0.1', asset: 'ETH.ETH' },
            ],
          })
        )
    )

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_000_000n,
      })
    ).rejects.toThrow('SwapKit affiliate and service fees use different assets.')
  })

  it('rejects an independent stable fee outside a Chainflip route', async () => {
    const usdcId = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'jupiter-stable-fee', providers: ['JUPITER'], expectedBuyAmount: '1' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            expectedBuyAmount: '1',
            tx: 'serialized-solana-transaction',
            fees: [{ type: 'service', amount: '0.1', asset: `ETH.USDC-${usdcId}`, chain: 'Ethereum' }],
          })
        )
    )

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_000_000n,
      })
    ).rejects.toThrow(`SwapKit service fee uses unsupported asset ETH.USDC-${usdcId}.`)
  })

  it('rejects a fee whose chain metadata contradicts its asset', async () => {
    const usdcId = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [{ routeId: 'chainflip-wrong-fee-chain', providers: ['CHAINFLIP'], expectedBuyAmount: '1' }],
          })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['CHAINFLIP'],
            expectedBuyAmount: '1',
            tx: 'serialized-solana-transaction',
            fees: [{ type: 'service', amount: '0.1', asset: `ETH.USDC-${usdcId}`, chain: 'Solana' }],
          })
        )
    )

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Solana, address: 'sol-source', ticker: 'SOL', decimals: 9 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_000_000n,
      })
    ).rejects.toThrow(`SwapKit service fee uses unsupported asset ETH.USDC-${usdcId}.`)
  })

  it('uses the Vultisig proxy without an API key by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.01',
          providers: ['NEAR'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { to: EVM_TARGET_ADDRESS, value: '100' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    // Explicitly set the Windows proxy URL; the default is platform-detected
    // (darwin/ios -> /swapkit, android -> /swapkit-a, other -> /swapkit-win).
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Bitcoin, address: 'bc1destination', ticker: 'BTC', decimals: 8 },
      amount: 1n,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vultisig.com/swapkit-win/v3/quote')
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBeUndefined()
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.vultisig.com/swapkit-win/v3/swap')
    expect(fetchMock.mock.calls[1][1].headers['x-api-key']).toBeUndefined()
  })

  it('does not let an undefined base URL override the current config', () => {
    configureSwapKit({ baseUrl: 'https://swapkit.example' })
    configureSwapKit({ baseUrl: undefined })

    expect(getSwapKitConfig().baseUrl).toBe('https://swapkit.example')
  })

  it('ranks routes without valid expected buy amounts after valid routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            { routeId: 'missing-amount-route', providers: ['NEAR'] },
            { routeId: 'malformed-amount-route', providers: ['NEAR'], expectedBuyAmount: 'not-a-number' },
            { routeId: 'valid-route', providers: ['NEAR'], expectedBuyAmount: '9.4' },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '9.3',
          providers: ['NEAR'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { to: EVM_TARGET_ADDRESS, value: '5000000000000000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Sui, address: '0xsui', ticker: 'SUI', decimals: 9 },
      amount: 5_000_000_000_000_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).routeId).toBe('valid-route')
  })

  it('throws a below-minimum error when providerErrors carry a minimum-size rejection (no-route response)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          routes: [],
          error: 'noRoutesFound',
          message: 'No routes found for BTC.BTC -> ETH.ETH',
          providerErrors: [
            {
              provider: 'CHAINFLIP',
              message: 'Amount below minimum: 0.0003 BTC required',
              errorCode: 'BELOW_MINIMUM',
            },
          ],
        },
        false,
        400
      )
    )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Bitcoin, address: 'bc1qsource', ticker: 'BTC', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1000n,
      })
    ).rejects.toThrow('CHAINFLIP: Amount below minimum: 0.0003 BTC required')
  })

  it('throws a below-minimum error when providerErrors carry a minimum-size rejection (200 with empty routes)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ routes: [], providerErrors: [{ provider: 'NEAR', message: 'min amount not met for this swap' }] })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Bitcoin, address: 'bc1qsource', ticker: 'BTC', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 100n,
      })
    ).rejects.toThrow('NEAR: min amount not met for this swap')
  })

  it('returns a valid route when providerErrors carry below-minimum alongside valid routes (no UX regression)', async () => {
    // Updated #535 r3 (NeO preferably-blocking): when SwapKit returns a usable
    // route AND a below-minimum providerError, we MUST return the route. The
    // earlier behavior (throwing the providerError) blocked users from a
    // route they could otherwise execute. Below-min surfacing is now gated
    // on `allowedRoutes.length === 0`. EVM→Sui path so we can reuse the
    // existing NEAR-route mock shape (UTXO source would need different
    // tx envelope structure).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '9.4' }],
          providerErrors: [
            { provider: 'CHAINFLIP', message: 'Amount below minimum: 0.0003 BTC required', errorCode: 'BELOW_MINIMUM' },
          ],
        })
      )
      .mockResolvedValueOnce(
        // Second call: route-detail fetch for the selected NEAR route.
        response({
          expectedBuyAmount: '9.3',
          providers: ['NEAR'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { to: EVM_TARGET_ADDRESS, value: '5000000000000000', gasLimit: '21000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    // Must NOT throw — the NEAR route is valid and should be returned even
    // though CHAINFLIP rejected for below-minimum.
    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Sui, address: '0xsui', ticker: 'SUI', decimals: 9 },
      amount: 5_000_000_000_000_000n,
    })

    expect(quote).toMatchObject({ provider: 'swapkit', routeProvider: 'NEAR' })
  })

  it('falls back to focused provider groups when the broad SwapKit provider query misses a route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: 'noRoutesFound' }, false, 400))
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'near-sui-route', providers: ['NEAR'], expectedBuyAmount: '9.4' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '9.3',
          providers: ['NEAR'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { to: EVM_TARGET_ADDRESS, value: '5000000000000000', gasLimit: '21000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Sui, address: '0xsui', ticker: 'SUI', decimals: 9 },
      amount: 5_000_000_000_000_000n,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).providers).toContain('CHAINFLIP')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).providers).toEqual(['NEAR'])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      routeId: 'near-sui-route',
      sourceAddress: '0xsender',
      destinationAddress: '0xsui',
      disableBalanceCheck: true,
    })
    expect(quote).toMatchObject({
      dstAmount: '9300000000',
      provider: 'swapkit',
      routeProvider: 'NEAR',
      tx: { evm: { to: EVM_TARGET_ADDRESS, value: '5000000000000000', gasLimit: 21000n } },
    })
  })

  it('reclassifies noRoutesFound to an amount-below-minimum error when the pair is structurally supported (#4418)', async () => {
    resetSwapKitProvidersCache()
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/providers')) {
        return response([{ provider: 'NEAR', enabledChainIds: ['bitcoincash', '1'] }])
      }
      return response({ error: 'noRoutesFound', message: 'No routes found for BCH.BCH -> ETH.ETH' }, false, 404)
    })

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    // The issue #3987 pair: BCH -> ETH at a below-minimum amount. SwapKit only
    // returns noRoutesFound (no providerErrors), but NEAR structurally supports
    // the pair, so we surface an actionable amount error instead of "no route".
    await expect(
      getSwapKitQuote({
        from: { chain: Chain.BitcoinCash, address: 'bitcoincash:qsource', ticker: 'BCH', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_150_000n,
      })
    ).rejects.toBeInstanceOf(SwapKitAmountBelowMinimumError)
  })

  it('rethrows the no-eligible-routes error when the pair is not structurally supported', async () => {
    resetSwapKitProvidersCache()
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/providers')) {
        // No provider co-enables litecoin + ETH, so the pair is genuinely unsupported.
        return response([{ provider: 'NEAR', enabledChainIds: ['1', 'solana'] }])
      }
      return response({ error: 'noRoutesFound' }, false, 404)
    })

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Litecoin, address: 'ltc1qsource', ticker: 'LTC', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1000n,
      })
    ).rejects.toBeInstanceOf(SwapKitNoEligibleRoutesError)
  })

  // Inner-spender fix: SwapKit `/v3/swap` returns a top-level `approvalTx` whose
  // approve() spender is the route's INNER executor (e.g. the 1inch executor
  // 0x6c0ad82f…), NOT the outer Diamond router. Approving only the router
  // reverts "transfer amount exceeds allowance". We decode that spender and
  // surface it as evm.approvalAddress so the approve leg targets it.
  // On-chain proof: USDC→ETH tx 0xa3aadf17 (approve spender 0x6c0ad82f…).
  it('threads the approvalTx approve() spender onto evm.approvalAddress', async () => {
    // approve(0x6c0ad82f9721a6dc986381d19338601a2e6370e5, amount)
    const innerExecutor = '0x6c0ad82f9721a6dc986381d19338601a2e6370e5'
    const approveData = '0x095ea7b3' + '000000000000000000000000' + innerExecutor.slice(2) + 'f'.repeat(64)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'one-inch-route', providers: ['ONEINCH'], expectedBuyAmount: '0.3' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.3',
          providers: ['ONEINCH'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xda5d4170', value: '0', gas: '210000' },
          approvalTx: { to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', data: approveData },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'USDC',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
      },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000n,
    })

    expect(quote.tx).toMatchObject({ evm: { to: EVM_TARGET_ADDRESS, approvalAddress: innerExecutor } })
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(EVM_TARGET_ADDRESS, 'ethereum')
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(innerExecutor, 'ethereum')
  })

  it('omits evm.approvalAddress when the swap response carries no approvalTx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'native-route', providers: ['ONEINCH'], expectedBuyAmount: '12.4' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['ONEINCH'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'USDC', decimals: 6 },
      amount: 10_000_000_000_000_000n,
    })

    const evmTx = quote.tx as { evm: Record<string, unknown> }
    expect(evmTx.evm).toBeDefined()
    expect(evmTx.evm.approvalAddress).toBeUndefined()
  })

  it('omits evm.approvalAddress when the approvalTx spender is the zero address', async () => {
    // approve(0x0000000000000000000000000000000000000000, amount) — never a
    // real allowance target; mirror LiFi's zero-address omit so the consumer
    // keeps the tx.to fallback.
    const zeroSpenderApproveData = `0x095ea7b3${'0'.repeat(24)}${'0'.repeat(40)}${'0'.repeat(64)}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'zero-spender-route', providers: ['ONEINCH'], expectedBuyAmount: '12.4' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['ONEINCH'],
          targetAddress: EVM_TARGET_ADDRESS,
          tx: { from: '0xsender', to: EVM_TARGET_ADDRESS, data: '0xabcdef', value: '0', gas: '21000' },
          approvalTx: { from: '0xsender', to: '0xtoken', data: zeroSpenderApproveData },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'USDC', decimals: 6 },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      amount: 10_000_000n,
    })

    const evmTx = quote.tx as { evm: Record<string, unknown> }
    expect(evmTx.evm).toBeDefined()
    expect(evmTx.evm.approvalAddress).toBeUndefined()
  })

  it.each([['Cardano', Chain.Cardano, 'addr1source', 'ADA', 6]] as const)(
    '%s is dispatch-eligible as a SwapKit source (in swapKitSourceChains) but getSwapKitQuote rejects it explicitly, before any network call, since no tx-build path exists yet',
    async (_label, chain, address, ticker, decimals) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        getSwapKitQuote({
          from: { chain, address, ticker, decimals },
          to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
          amount: 1000n,
        })
      ).rejects.toThrow(`SwapKit ${chain} source swaps are not yet supported for signing`)

      // The whole point of rejecting up front is to never spend a `/v3/quote`
      // or `/v3/swap` round-trip on a request that can never produce a
      // signable tx.
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  // Base64 is the SwapKit wire shape for a Sui source. It must reach the
  // keysign payload as raw bytes so an iOS/Android cosigner rebuilds a
  // byte-identical signing input.
  const suiPtbBase64 = Buffer.from('sui-programmable-transaction-block').toString('base64')

  const stubSuiRoute = (meta: Record<string, unknown> | undefined) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '0.5' }] })
      )
      .mockResolvedValueOnce(
        response({ providers: ['NEAR'], targetAddress: 'sui-deposit', ...(meta ? { meta } : {}), tx: suiPtbBase64 })
      )
    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key' })

    return fetchMock
  }

  const quoteSuiSource = () =>
    getSwapKitQuote({
      from: { chain: Chain.Sui, address: 'sui-source', ticker: 'SUI', decimals: 9 },
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_500_000_000n,
    })

  it('maps a Sui source route to a transfer tx carrying the decoded PTB bytes', async () => {
    stubSuiRoute({ txType: 'SUI' })

    const quote = await quoteSuiSource()

    expect(quote.tx).toEqual({
      transfer: {
        to: 'sui-deposit',
        // No depositAmount and a string (non-array) `tx`, so the requested sell
        // amount carries through. Informational only — the real amount is baked
        // into the PTB.
        amount: 1_500_000_000n,
        txType: 'SUI',
        txPayload: new Uint8Array(Buffer.from(suiPtbBase64, 'base64')),
      },
    })
  })

  it.each([
    ['a renamed base64 txType', { txType: 'SERIALIZED_BASE64' }],
    ['no meta at all', undefined],
  ])('normalizes a Sui route txType to SUI given %s', async (_label, meta) => {
    stubSuiRoute(meta)

    const quote = await quoteSuiSource()

    // SwapKit renamed SOLANA -> SERIALIZED_BASE64 mid-flight without
    // versioning. Trusting the wire label would base64-encode the PTB string
    // as UTF-8 instead of decoding it, and would break cross-device cosigning
    // against iOS, which always stamps "SUI".
    expect(quote.tx).toEqual({
      transfer: {
        to: 'sui-deposit',
        amount: 1_500_000_000n,
        txType: 'SUI',
        txPayload: new Uint8Array(Buffer.from(suiPtbBase64, 'base64')),
      },
    })
  })

  it('does not disable tx building for a Sui source (the PTB is what gets signed)', async () => {
    const fetchMock = stubSuiRoute({ txType: 'SUI' })

    await quoteSuiSource()

    const swapCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v3/swap'))
    const swapBody = JSON.parse(swapCall![1].body)

    // Sending disableBuildTx here makes SwapKit return a response with NO `tx`,
    // so there is no PTB to sign and the keysign payload build fails.
    expect(swapBody.disableBuildTx).toBeUndefined()
    expect(swapBody.sourceAddress).toBe('sui-source')
  })

  it('rejects a Sui route whose tx is not a base64 string', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '0.5' }] })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['NEAR'],
            targetAddress: 'sui-deposit',
            meta: { txType: 'SUI' },
            tx: { some: 'object' },
          })
        )
    )
    configureSwapKit({ apiKey: 'test-key' })

    // Falling through would JSON-encode the object into `txPayload` and produce
    // a signable-looking but nonsense PTB. Fail loudly instead.
    await expect(quoteSuiSource()).rejects.toThrow(
      'SwapKit Sui route did not return a base64 programmable transaction block.'
    )
  })
})
