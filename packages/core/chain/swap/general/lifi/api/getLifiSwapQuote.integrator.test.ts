import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { _resetLifiConfigForTest, lifiConfig, setupLifi } from '../config'

// Capture every getQuote(...) invocation so we can assert the `integrator`
// field is the consumer-supplied override (Station's `station`), NOT the
// SDK-default vultisig-0. createConfig is a no-op spy because the @lifi/sdk
// global runs once and persists across tests inside the same worker.
const getQuoteSpy = vi.fn()
const createConfigSpy = vi.fn()

vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createConfig: (...args: unknown[]) => createConfigSpy(...args),
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
    createConfigSpy.mockReset()
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
    expect(getQuoteSpy.mock.calls[0]![0].integrator).toBe('vultisig-0')
  })

  it('uses consumer-supplied integratorName when LifiAffiliateConfig provided', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote({
      ...baseInput,
      lifiAffiliateConfig: { integratorName: 'station' },
    } as never)
    expect(getQuoteSpy.mock.calls[0]![0].integrator).toBe('station')
  })

  it('per-call override does NOT mutate the global lifiConfig', async () => {
    const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
    await getLifiSwapQuote({
      ...baseInput,
      lifiAffiliateConfig: { integratorName: 'station' },
    } as never)
    expect(lifiConfig.integratorName).toBe('vultisig-0')
  })

  it('setupLifi({integratorName, apiUrl}) calls createConfig with both fields', () => {
    setupLifi({ integratorName: 'station', apiUrl: 'https://api.vultisig.com/lifi/' })
    expect(createConfigSpy).toHaveBeenCalledWith({
      integrator: 'station',
      apiUrl: 'https://api.vultisig.com/lifi/',
    })
    expect(lifiConfig.integratorName).toBe('station')
    expect(lifiConfig.apiUrl).toBe('https://api.vultisig.com/lifi/')
  })

  it('setupLifi() with no config calls createConfig with just the default integrator (no apiUrl)', () => {
    setupLifi()
    expect(createConfigSpy).toHaveBeenCalledWith({ integrator: 'vultisig-0' })
  })

  it('setupLifi is idempotent — second call is a no-op', () => {
    setupLifi({ integratorName: 'station', apiUrl: 'https://api.vultisig.com/lifi/' })
    setupLifi({ integratorName: 'someone-else' })
    expect(createConfigSpy).toHaveBeenCalledTimes(1)
    expect(lifiConfig.integratorName).toBe('station')
  })
})
