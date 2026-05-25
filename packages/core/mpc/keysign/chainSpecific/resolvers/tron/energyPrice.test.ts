import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock queryUrl BEFORE importing the module so the in-memory cache starts
// clean for each test via vi.resetModules() in afterEach.
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const queryUrlMock = vi.mocked(queryUrl)

// Re-import fresh module after resetting module registry so the memoize
// cache (module-level singleton) starts empty for every test.
const loadModule = () => import('./energyPrice?t=' + Date.now())

afterEach(() => {
  vi.resetModules()
  queryUrlMock.mockReset()
})

describe('getEnergyPrice', () => {
  it('returns fetched energy price when endpoint responds', async () => {
    queryUrlMock.mockResolvedValue({
      chainParameter: [
        { key: 'getEnergyFee', value: 420 },
        { key: 'someOtherParam', value: 999 },
      ],
    })

    const { getEnergyPrice } = await loadModule()
    const price = await getEnergyPrice()

    expect(price).toBe(420n)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to 280n when fetch throws', async () => {
    queryUrlMock.mockRejectedValue(new Error('network error'))

    const { getEnergyPrice } = await loadModule()
    const price = await getEnergyPrice()

    expect(price).toBe(280n)
  })

  it('falls back to 280n when getEnergyFee key is absent', async () => {
    queryUrlMock.mockResolvedValue({
      chainParameter: [{ key: 'someOtherParam', value: 999 }],
    })

    const { getEnergyPrice } = await loadModule()
    const price = await getEnergyPrice()

    expect(price).toBe(280n)
  })

  it('falls back to 280n when chainParameter array is missing', async () => {
    queryUrlMock.mockResolvedValue({})

    const { getEnergyPrice } = await loadModule()
    const price = await getEnergyPrice()

    expect(price).toBe(280n)
  })

  it('falls back to 280n when getEnergyFee value is 0', async () => {
    // value: 0 would produce BigInt(0) -> totalEnergy * 0n = 0n -> free fees -> tx fails on-chain
    queryUrlMock.mockResolvedValue({
      chainParameter: [{ key: 'getEnergyFee', value: 0 }],
    })

    const { getEnergyPrice } = await loadModule()
    const price = await getEnergyPrice()

    expect(price).toBe(280n)
  })

  it('recovers immediately after a failed fetch (errors are not cached)', async () => {
    // Call 1: network error -> fallback
    queryUrlMock.mockRejectedValue(new Error('network error'))
    const { getEnergyPrice } = await loadModule()
    const fallbackPrice = await getEnergyPrice()
    expect(fallbackPrice).toBe(280n)

    // Call 2: TronGrid recovers -> should return live price, NOT cached fallback
    queryUrlMock.mockResolvedValue({
      chainParameter: [{ key: 'getEnergyFee', value: 420 }],
    })
    const recoveredPrice = await getEnergyPrice()
    expect(recoveredPrice).toBe(420n)
    // queryUrl was called twice: once for the error, once for the recovery
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
  })

  it('returns cached result on second call within TTL', async () => {
    queryUrlMock.mockResolvedValue({
      chainParameter: [{ key: 'getEnergyFee', value: 300 }],
    })

    const { getEnergyPrice } = await loadModule()
    const first = await getEnergyPrice()
    const second = await getEnergyPrice()

    expect(first).toBe(300n)
    expect(second).toBe(300n)
    // memoizeAsync should have only hit the network once
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })
})
