import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { _resetLifiConfigForTest, lifiConfig, setupLifi } from '../config'

// Capture every getQuote(...) invocation so we can assert the `integrator`
// field is the consumer-supplied override (Station's `station`), NOT the
// SDK-default vultisig-0. createClient is a spy returning a dummy client —
// in @lifi/sdk v4 actions take the client as their first arg (the v3 global
// mutable singleton is gone), so getQuote is called as getQuote(client, params).
const getQuoteSpy = vi.fn()
const createClientSpy = vi.fn()
const mockLifiClient = { config: {}, providers: [] }

vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createClient: (...args: unknown[]) => {
    createClientSpy(...args)
    return mockLifiClient
  },
  getQuote: (...args: unknown[]) => getQuoteSpy(...args),
}))

// Minimal shims for the @vultisig/core-chain imports getLifiSwapQuote pulls.
// We only need the surface getLifiSwapQuote actually touches; everything
// else is stubbed to keep the test focused on the integrator wire-up.
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
// Always-evaluate `memoize` so test resets actually rebuild the closure;
// production behaviour (memoise once) is what we want to verify too —
// covered by lifiConfig.integratorName flipping under setupLifi.
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

describe('getLifiSwapQuote — integrator override', () => {
  beforeEach(() => {
    getQuoteSpy.mockReset()
    createClientSpy.mockReset()
    _resetLifiConfigForTest()
    // Stable bridge-less EVM EVM happy-path response — enough to satisfy the
    // function's post-quote unwrap. The test only inspects getQuote's args.
    getQuoteSpy.mockResolvedValue({
      transactionRequest: {
        value: '0',
        gasLimit: '0',
        data: '0x',
        from: '0xfrom',
        to: '0xto',
        chainId: 1,
      },
      estimate: {
        toAmount: '999000',
        gasCosts: [{ amount: '0' }],
        feeCosts: [{ name: 'LIFI Fixed Fee', amount: '0', token: { decimals: 6, address: 'USDT', chainId: 1 } }],
      },
    })
  })
  afterEach(() => {
    _resetLifiConfigForTest()
  })

  it('falls back to vultisig-0 default when no LifiAffiliateConfig provided', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote(baseInput as never)
    expect(getQuoteSpy).toHaveBeenCalledTimes(1)
    // v4: getQuote(client, params) — params (with the integrator tag) is arg[1].
    expect(getQuoteSpy.mock.calls[0]![1].integrator).toBe('vultisig-0')
  })

  it('uses consumer-supplied integratorName when LifiAffiliateConfig provided', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote({
      ...baseInput,
      lifiAffiliateConfig: { integratorName: 'station' },
    } as never)
    expect(getQuoteSpy.mock.calls[0]![1].integrator).toBe('station')
  })

  it('per-call override does NOT mutate the global lifiConfig', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote({
      ...baseInput,
      lifiAffiliateConfig: { integratorName: 'station' },
    } as never)
    expect(lifiConfig.integratorName).toBe('vultisig-0')
  })

  it('setupLifi({integratorName, apiUrl}) calls createClient with both fields', () => {
    setupLifi({ integratorName: 'station', apiUrl: 'https://api.vultisig.com/lifi/' })
    expect(createClientSpy).toHaveBeenCalledWith({
      integrator: 'station',
      apiUrl: 'https://api.vultisig.com/lifi/',
    })
    expect(lifiConfig.integratorName).toBe('station')
    expect(lifiConfig.apiUrl).toBe('https://api.vultisig.com/lifi/')
  })

  it('setupLifi() with no config calls createClient with just the default integrator (no apiUrl)', () => {
    setupLifi()
    expect(createClientSpy).toHaveBeenCalledWith({ integrator: 'vultisig-0' })
  })

  it('lazy setupLifi() AFTER consumer setupLifi(config) is a no-op (consumer wins)', () => {
    // The lazy path (called by ensureLifiConfigured before each getQuote)
    // must not undo a consumer bootstrap. Once a consumer explicitly
    // configured Station, a subsequent lazy default call should NOT
    // re-issue createClient with vultisig-0.
    setupLifi({ integratorName: 'station', apiUrl: 'https://api.vultisig.com/lifi/' })
    setupLifi() // lazy fallback
    expect(createClientSpy).toHaveBeenCalledTimes(1)
    expect(lifiConfig.integratorName).toBe('station')
  })

  it('consumer setupLifi(config) AFTER lazy default re-runs createClient (footgun fix)', () => {
    // Ehsan-saradar #618: previously the lazy default would latch
    // configured=true with vultisig-0, and a later consumer bootstrap
    // would silently no-op — Station's apiUrl proxy gets lost. The fix:
    // the consumer-bootstrap branch always runs createClient regardless
    // of latch state.
    setupLifi() // lazy path runs first (e.g. a swap quote fires early)
    setupLifi({ integratorName: 'station', apiUrl: 'https://api.vultisig.com/lifi/' })
    expect(createClientSpy).toHaveBeenCalledTimes(2)
    expect(createClientSpy).toHaveBeenLastCalledWith({
      integrator: 'station',
      apiUrl: 'https://api.vultisig.com/lifi/',
    })
    expect(lifiConfig.integratorName).toBe('station')
    expect(lifiConfig.apiUrl).toBe('https://api.vultisig.com/lifi/')
  })

  it('consumer setupLifi(config) repeated calls re-run createClient with each new config', () => {
    // Mirrors the production reality where a misuse (two consumers in the
    // same process) results in the second-caller's createClient taking
    // effect on the LI.FI SDK. Document the semantics so a future
    // multi-tenant setup doesn't surprise anyone.
    setupLifi({ integratorName: 'station' })
    setupLifi({ integratorName: 'someone-else' })
    expect(createClientSpy).toHaveBeenCalledTimes(2)
    expect(lifiConfig.integratorName).toBe('someone-else')
  })
})
