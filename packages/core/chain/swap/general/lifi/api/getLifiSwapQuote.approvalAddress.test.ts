import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// LI.FI's `estimate.approvalAddress` is the top-level spender that will call
// `transferFrom` on the user's input ERC-20. It must be the same official
// chain-scoped Diamond as `transactionRequest.to`; nested route executors are
// funded by the Diamond and never receive the user's allowance directly.

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
        to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // official LI.FI Diamond
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

const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const ATTACKER_SPENDER = '0x7f51c134000000000000000000000000000c7e11'
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

  it('threads the verified LI.FI Diamond approvalAddress onto evm.approvalAddress', async () => {
    fixture.approvalAddress = LIFI_DIAMOND
    const evm = await getEvmTx()
    expect(evm.approvalAddress).toBe(LIFI_DIAMOND)
  })

  it('rejects an approvalAddress outside the LI.FI chain-scoped Diamond allowlist', async () => {
    fixture.approvalAddress = ATTACKER_SPENDER

    await expect(getEvmTx()).rejects.toThrow(/unrecognized router address/i)
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
