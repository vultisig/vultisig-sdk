import { describe, expect, it, vi } from 'vitest'

// Mirrors the core getLifiSwapQuote.approvalAddress.test.ts — the RN/Hermes
// override is a SEPARATE build target (rollup.platforms.config.js redirects
// core's getLifiSwapQuote.ts here), and its header contract says "Public
// surface mirrors core byte-for-byte". Without this lockstep test the app
// platform could silently lose the inner-executor approvalAddress exposure
// (#895) while every core test stays green — the exact two-bundle seam that
// bit the cosmos fee-denom helpers (#1199).

const fixture = vi.hoisted(() => ({
  approvalAddress: undefined as string | undefined,
  getQuoteMock: vi.fn(),
}))

vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createClient: () => ({ config: {}, providers: [] }),
  getQuote: fixture.getQuoteMock,
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/config', () => ({
  getLifiClient: () => ({}),
  setupLifi: vi.fn(),
  lifiConfig: { integratorName: 'vultisig-0' },
}))
// The evm arm never reaches the Solana ATA injection, but the REAL module
// drags @solana/web3.js + @vultisig/core-config's dist build into the graph;
// mock it out to keep this unit hermetic (same as the core test).
vi.mock('@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing', () => ({
  injectSolanaAtaIfMissing: () => ({ data: '', ataInjected: false }),
}))

import { getLifiSwapQuote } from '@/platforms/react-native/overrides/getLifiSwapQuote'

const INNER_EXECUTOR = '0x7f51c134000000000000000000000000000c7e11'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const quoteResponse = () => ({
  transactionRequest: {
    value: '0',
    gasLimit: '21000',
    data: '0xabcdef',
    from: '0xfrom',
    to: '0x9025b8ff00000000000000000000000000d1a30d', // outer Diamond router
    chainId: 1,
  },
  estimate: {
    toAmount: '999000',
    gasCosts: [{ amount: '0' }],
    feeCosts: [{ name: 'LIFI Fixed Fee', amount: '0', token: { decimals: 6, address: 'USDT', chainId: 1 } }],
    ...(fixture.approvalAddress !== undefined ? { approvalAddress: fixture.approvalAddress } : {}),
  },
})

const baseInput = {
  from: { id: 'USDC', chain: 'Ethereum', address: '0xfrom', ticker: 'USDC' },
  to: { id: 'USDT', chain: 'Ethereum', address: '0xto', ticker: 'USDT' },
  amount: 1_000_000n,
  affiliateBps: 30,
}

const getEvmTx = async () => {
  fixture.getQuoteMock.mockResolvedValueOnce(quoteResponse())
  const quote = await getLifiSwapQuote(baseInput as never)
  return (quote.tx as { evm: Record<string, unknown> }).evm
}

describe('RN getLifiSwapQuote override — evm.approvalAddress lockstep with core (#895)', () => {
  it('threads a non-zero estimate.approvalAddress (inner executor) onto evm.approvalAddress', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    const evm = await getEvmTx()
    expect(evm.approvalAddress).toBe(INNER_EXECUTOR)
  })

  it('omits evm.approvalAddress for the zero address (native-only routes)', async () => {
    fixture.approvalAddress = ZERO_ADDRESS
    const evm = await getEvmTx()
    expect(evm).toBeDefined()
    expect(evm.approvalAddress).toBeUndefined()
  })

  it('omits evm.approvalAddress when the estimate carries none', async () => {
    fixture.approvalAddress = undefined
    const evm = await getEvmTx()
    expect(evm).toBeDefined()
    expect(evm.approvalAddress).toBeUndefined()
  })
})
