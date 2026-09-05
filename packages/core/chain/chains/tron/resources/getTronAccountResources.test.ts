import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tronRpcUrl } from '../config'
import { getTronAccountResources } from './getTronAccountResources'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

const address = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'

describe('getTronAccountResources', () => {
  beforeEach(() => vi.resetAllMocks())

  it('aggregates free and staked bandwidth, energy, frozen balances and ordered withdrawals', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        frozenV2: [
          { amount: 1_000_000 },
          { type: null, amount: 2_000_000 },
          { type: 'BANDWIDTH', amount: 3_000_000 },
          { type: 'BANDWIDTH' },
          { type: 'ENERGY', amount: 4_000_000 },
          { type: 'ENERGY', amount: 5_000_000 },
          { type: 'ENERGY', amount: null },
          { type: 'UNKNOWN', amount: 99_000_000 },
        ],
        unfrozenV2: [
          { unfreeze_amount: 9_000_000, unfreeze_expire_time: 3000 },
          { unfreeze_amount: 2_000_000, unfreeze_expire_time: 1000 },
          { unfreeze_amount: 0, unfreeze_expire_time: 0 },
          { unfreeze_amount: 7 },
          { unfreeze_expire_time: 2000 },
          { unfreeze_amount: null, unfreeze_expire_time: 2000 },
          { unfreeze_amount: 7, unfreeze_expire_time: null },
        ],
      })
      .mockResolvedValueOnce({
        freeNetLimit: 600,
        freeNetUsed: 100,
        NetLimit: 1000,
        NetUsed: 300,
        EnergyLimit: 5000,
        EnergyUsed: 1200,
      })

    await expect(getTronAccountResources(address)).resolves.toEqual({
      bandwidth: { available: 1200, total: 1600, used: 400 },
      energy: { available: 3800, total: 5000, used: 1200 },
      frozenForBandwidthSun: 6_000_000n,
      frozenForEnergySun: 9_000_000n,
      unfreezingEntries: [
        { unfreezeAmountSun: 0n, expireTimeMs: 0 },
        { unfreezeAmountSun: 2_000_000n, expireTimeMs: 1000 },
        { unfreezeAmountSun: 9_000_000n, expireTimeMs: 3000 },
      ],
    })
    expect(queryUrl).toHaveBeenCalledTimes(2)
    for (const endpoint of ['getaccount', 'getaccountresource']) {
      expect(queryUrl).toHaveBeenCalledWith(`${tronRpcUrl}/wallet/${endpoint}`, { body: { address, visible: true } })
    }
  })

  it('defaults omitted account and resource fields to zero', async () => {
    vi.mocked(queryUrl).mockResolvedValue({})
    await expect(getTronAccountResources(address)).resolves.toEqual({
      bandwidth: { available: 0, total: 0, used: 0 },
      energy: { available: 0, total: 0, used: 0 },
      frozenForBandwidthSun: 0n,
      frozenForEnergySun: 0n,
      unfreezingEntries: [],
    })
  })

  it('clamps overused resources to zero availability while preserving usage', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({}).mockResolvedValueOnce({
      freeNetLimit: 600,
      freeNetUsed: 700,
      NetLimit: 100,
      NetUsed: 200,
      EnergyLimit: 10,
      EnergyUsed: 11,
    })
    const result = await getTronAccountResources(address)
    expect(result.bandwidth).toEqual({ available: 0, total: 700, used: 900 })
    expect(result.energy).toEqual({ available: 0, total: 10, used: 11 })
  })

  it.each([0, 1])('propagates failure from query %i', async failingQuery => {
    const error = new Error('provider unavailable')
    vi.mocked(queryUrl).mockImplementation(async url => {
      if (url === `${tronRpcUrl}/wallet/${failingQuery === 0 ? 'getaccount' : 'getaccountresource'}`) throw error
      return {}
    })
    await expect(getTronAccountResources(address)).rejects.toBe(error)
  })
})
