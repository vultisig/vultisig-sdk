import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

const USDT_RAW = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe'
const STAKED_RAW = '0:aa0ba121449feda569e02b12fa755d24e834a7454aecf4649590b6df742aac8f'

const tonAssets = [
  { address: USDT_RAW, name: 'Tether USD', symbol: 'USD₮' },
  {
    address: STAKED_RAW.toUpperCase(),
    name: 'Staked TON',
    symbol: 'STAKED',
    decimals: 9,
    image: 'https://example.com/staked.png',
    coingecko: 'staked-ton',
  },
  { address: '0:' + '1'.repeat(64), name: 'No symbol' },
]

const loadModule = async () => {
  vi.resetModules()
  return import('./verifiedRegistry')
}

describe('makeTonVerifiedJettonRegistry', () => {
  it('indexes addresses as lower-cased raw keys and symbols/names as normalized skeletons', async () => {
    const { makeTonVerifiedJettonRegistry } = await loadModule()

    const registry = makeTonVerifiedJettonRegistry([
      { address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', symbol: 'USD₮', name: 'Tether USD' },
    ])

    expect(Object.keys(registry.byAddress)).toEqual([USDT_RAW])
    expect(registry.symbols.has('USDT')).toBe(true)
    expect(registry.names.has('TETHERUSD')).toBe(true)
  })

  it('keeps the first entry for an address so curated metadata wins over the whitelist', async () => {
    const { makeTonVerifiedJettonRegistry } = await loadModule()

    const registry = makeTonVerifiedJettonRegistry([
      { address: USDT_RAW, symbol: 'USDT', priceProviderId: 'tether' },
      { address: USDT_RAW.toUpperCase(), symbol: 'USD₮' },
    ])

    expect(registry.byAddress[USDT_RAW]).toEqual({ address: USDT_RAW, symbol: 'USDT', priceProviderId: 'tether' })
  })
})

describe('getTonVerifiedJettonRegistry', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('merges the curated TON tokens with the ton-assets whitelist', async () => {
    queryUrlMock.mockResolvedValue(tonAssets)
    const { getTonVerifiedJettonRegistry, tonAssetsJettonsUrl } = await loadModule()

    const registry = await getTonVerifiedJettonRegistry()

    expect(queryUrlMock).toHaveBeenCalledWith(tonAssetsJettonsUrl)
    // Curated USDT keeps its own ticker and price id even though the whitelist spells it USD₮.
    expect(registry.byAddress[USDT_RAW]).toMatchObject({ symbol: 'USDT', decimals: 6, priceProviderId: 'tether' })
    expect(registry.byAddress[STAKED_RAW]).toEqual({
      address: STAKED_RAW,
      symbol: 'STAKED',
      name: 'Staked TON',
      decimals: 9,
      logo: 'https://example.com/staked.png',
      priceProviderId: 'staked-ton',
    })
    expect(registry.names.has('TETHERUSD')).toBe(true)
    expect(registry.byAddress['0:' + '1'.repeat(64)]).toBeUndefined()
  })

  it('caches a successful fetch', async () => {
    queryUrlMock.mockResolvedValue(tonAssets)
    const { getTonVerifiedJettonRegistry } = await loadModule()

    await getTonVerifiedJettonRegistry()
    await getTonVerifiedJettonRegistry()

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the curated list when the whitelist is unavailable, and retries next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queryUrlMock.mockRejectedValueOnce(new Error('offline'))
    const { getTonVerifiedJettonRegistry } = await loadModule()

    const degraded = await getTonVerifiedJettonRegistry()

    expect(degraded.byAddress[USDT_RAW]).toMatchObject({ symbol: 'USDT' })
    expect(degraded.byAddress[STAKED_RAW]).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)

    queryUrlMock.mockResolvedValueOnce(tonAssets)
    const recovered = await getTonVerifiedJettonRegistry()

    expect(recovered.byAddress[STAKED_RAW]).toBeDefined()
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('rejects a whitelist payload that is not a list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queryUrlMock.mockResolvedValueOnce({ error: 'rate limited' })
    const { getTonVerifiedJettonRegistry } = await loadModule()

    const registry = await getTonVerifiedJettonRegistry()

    expect(Object.keys(registry.byAddress)).toHaveLength(8)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
