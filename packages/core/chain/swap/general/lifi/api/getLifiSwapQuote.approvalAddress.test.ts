import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Inner-spender exposure (#895): LI.FI's `estimate.approvalAddress` is the
// address that will call `transferFrom` on the input ERC-20 — it can differ
// from `transactionRequest.to` (the Diamond) when an inner executor (e.g. a
// 1inch AggregationExecutor) pulls the token directly. These cases pin that
// the quote threads it onto `evm.approvalAddress` when it is a real address,
// and omits it for the zero address / an absent field so consumers keep the
// `tx.to` fallback (the pre-#895 behavior).

const fixture = vi.hoisted(() => ({
  approvalAddress: undefined as string | undefined,
}))

// jscpd:ignore-start — the LiFi module-mock + fixture scaffolding below is intentionally
// shared with getLifiSwapQuote.routerTelemetry.test.ts (same core module under test); the
// meaningful assertions are the approvalAddress cases further down.
vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createClient: () => ({ config: {}, providers: [] }),
  getQuote: () =>
    Promise.resolve({
      transactionRequest: {
        value: '0',
        gasLimit: '0',
        data: '0x',
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
    }),
}))
vi.mock('@vultisig/core-chain/ChainKind', () => ({
  getChainKind: () => 'evm',
  DeriveChainKind: {},
}))
vi.mock('@vultisig/core-chain/chains/solana/solanaConfig', () => ({
  solanaConfig: { ataRentLamports: 0 },
}))
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: new Proxy({}, { get: () => ({ ticker: 'ETH', id: 'ETH' }) }),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains', () => ({
  lifiSwapChainId: new Proxy({}, { get: () => 1 }),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing', () => ({
  injectSolanaAtaIfMissing: () => ({ data: '', ataInjected: false }),
}))
vi.mock('@vultisig/lib-utils/assert/shouldBePresent', () => ({
  shouldBePresent: <T>(v: T): T => v,
}))
vi.mock('@vultisig/lib-utils/match', () => ({
  match: (_kind: string, handlers: Record<string, () => unknown>) => handlers.evm(),
}))
vi.mock('@vultisig/lib-utils/memoize', () => ({
  memoize: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
}))
vi.mock('@vultisig/lib-utils/record/mirrorRecord', () => ({
  mirrorRecord: () => ({}),
}))
vi.mock('@vultisig/lib-utils/TransferDirection', () => ({
  TransferDirection: { from: 'from', to: 'to' },
}))

const baseInput = {
  from: { id: 'USDC', chain: 'Ethereum', address: '0xfrom', ticker: 'USDC' },
  to: { id: 'USDT', chain: 'Ethereum', address: '0xto', ticker: 'USDT' },
  amount: 1_000_000n,
  affiliateBps: 30,
}
// jscpd:ignore-end

const INNER_EXECUTOR = '0x7f51c134000000000000000000000000000c7e11'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const getEvmTx = async () => {
  const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
  const quote = await getLifiSwapQuote(baseInput as never)
  return (quote.tx as { evm: Record<string, unknown> }).evm
}

describe('getLifiSwapQuote — evm.approvalAddress exposure (#895)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    infoSpy.mockRestore()
    fixture.approvalAddress = undefined
  })

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
