import { scanAddressWithBlockaid } from '@vultisig/core-chain/security/blockaid/address'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mirrors the core getLifiSwapQuote.approvalAddress.test.ts — the RN/Hermes
// override is a SEPARATE build target (rollup.platforms.config.js redirects
// core's getLifiSwapQuote.ts here), and its header contract says "Public
// surface mirrors core byte-for-byte". Without this lockstep test the app
// platform could silently lose the approvalAddress safety contract while every
// core test stays green — the exact two-bundle seam that
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
vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))
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

const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const INNER_EXECUTOR = '0x7f51c134000000000000000000000000000c7e11'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const mockScanAddressWithBlockaid = vi.mocked(scanAddressWithBlockaid)

const quoteResponse = () => ({
  transactionRequest: {
    value: '0',
    gasLimit: '21000',
    data: '0xabcdef',
    from: '0xfrom',
    to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // official LI.FI Diamond
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
  beforeEach(() => {
    fixture.approvalAddress = undefined
    mockScanAddressWithBlockaid.mockReset()
    mockScanAddressWithBlockaid.mockResolvedValue({ resultType: 'Benign', features: ['trusted'] })
  })

  it('threads the verified LI.FI Diamond approvalAddress onto evm.approvalAddress', async () => {
    fixture.approvalAddress = LIFI_DIAMOND
    const evm = await getEvmTx()
    expect(evm.approvalAddress).toBe(LIFI_DIAMOND)
    expect(mockScanAddressWithBlockaid).not.toHaveBeenCalled()
  })

  it('threads a distinct route spender only after an independent benign reputation verdict', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    const evm = await getEvmTx()

    expect(evm.approvalAddress).toBe(INNER_EXECUTOR)
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(INNER_EXECUTOR, 'ethereum')
  })

  it('rejects a distinct route spender when the independent verdict is not benign', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Warning', features: ['untrusted'] })

    await expect(getEvmTx()).rejects.toThrow(/LI\.FI approval spender .*Warning Blockaid verdict/i)
  })

  it('fails closed when a distinct route spender cannot be reputation-checked', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('blockaid unreachable'))

    await expect(getEvmTx()).rejects.toThrow(/LI\.FI approval spender reputation check failed/i)
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

// P1 regression: the override used to hardcode a flat 1% slippage and discard the caller's
// `slippage` — so RN (most users) got a wider floor than web on stable pairs and silently ignored
// explicit tight-tolerance requests. It must now mirror core's tiered/override resolution.
describe('RN getLifiSwapQuote override — slippage mirrors core (P1)', () => {
  // getQuoteMock accumulates calls across tests (no beforeEach reset here), so read the latest.
  const slippageOf = () => (fixture.getQuoteMock.mock.calls.at(-1)![1] as { slippage: number }).slippage

  it('uses the 0.3% stable-pair tier for a USDC→USDT swap (not a flat 1%)', async () => {
    fixture.getQuoteMock.mockResolvedValueOnce(quoteResponse())
    await getLifiSwapQuote(baseInput as never)
    expect(slippageOf()).toBe(0.003)
  })

  it('uses the 1% volatile tier for a non-stable pair (ETH→USDC)', async () => {
    fixture.getQuoteMock.mockResolvedValueOnce(quoteResponse())
    await getLifiSwapQuote({
      ...baseInput,
      from: { id: undefined, chain: 'Ethereum', address: '0xfrom', ticker: 'ETH' },
    } as never)
    expect(slippageOf()).toBe(0.01)
  })

  it('honors an explicit consumer slippage override (no longer dropped)', async () => {
    fixture.getQuoteMock.mockResolvedValueOnce(quoteResponse())
    await getLifiSwapQuote({ ...baseInput, slippage: 0.001 } as never)
    expect(slippageOf()).toBe(0.001)
  })
})
