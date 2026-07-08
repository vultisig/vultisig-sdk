import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AGG-02 (round-2 spec-level fund-safety audit): LiFi routes through many different
// bridge/DEX contracts by design (diamond routing, multi-hop, chain-specific deployments),
// so — unlike 1inch/Kyber — its destination is logged (never enforced/thrown) via
// knownAggregatorRouters.ts's logUnenforcedAggregatorDestination. This proves that behavior:
// an unrecognized `to` never blocks the quote, and gets logged for future analysis.

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
        to: '0x000000000000000000000000000000deadbeef', // NOT a known router — never enforced for LiFi
        chainId: 1,
      },
      estimate: {
        toAmount: '999000',
        gasCosts: [{ amount: '0' }],
        feeCosts: [{ name: 'LIFI Fixed Fee', amount: '0', token: { decimals: 6, address: 'USDT', chainId: 1 } }],
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

describe('getLifiSwapQuote — AGG-02 router telemetry (log-only, never enforced)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    infoSpy.mockRestore()
  })

  it('does NOT throw for an unrecognized destination — LiFi is never enforced', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await expect(getLifiSwapQuote(baseInput as never)).resolves.toBeDefined()
  })

  it('logs the destination via swap-router-telemetry for future analysis', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote(baseInput as never)
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('swap-router-telemetry'), {
      provider: 'li.fi',
      address: '0x000000000000000000000000000000deadbeef',
    })
  })
})
