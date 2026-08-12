import { beforeEach, describe, expect, it, vi } from 'vitest'

// sdk#1458: LI.FI routes through many inner bridge/DEX contracts, but the user-facing
// EVM transaction enters through one officially published, chain-scoped Diamond.

const fixture = vi.hoisted(() => ({
  destination: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
}))

// jscpd:ignore-start — the LiFi module-mock + fixture scaffolding below is intentionally
// shared with getLifiSwapQuote.integrator.test.ts (same core module under test); the
// meaningful assertions are the telemetry cases further down. Follows the repo's existing
// convention for shared test mock boilerplate (cf. tests/integration/swap/swap-quote.test.ts).
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
        to: fixture.destination,
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
// jscpd:ignore-end

describe('getLifiSwapQuote — sdk#1458 LI.FI Diamond enforcement', () => {
  beforeEach(() => {
    vi.resetModules()
    fixture.destination = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
  })

  it('accepts the official LI.FI Diamond for the source chain', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await expect(getLifiSwapQuote(baseInput as never)).resolves.toBeDefined()
  })

  it('rejects an arbitrary destination before returning a signable quote', async () => {
    fixture.destination = '0x000000000000000000000000000000deadbeef'
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await expect(getLifiSwapQuote(baseInput as never)).rejects.toThrow(/unrecognized router address/)
  })
})
