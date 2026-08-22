import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCowSwapOrderStatus } from './getCowSwapOrderStatus'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

describe('getCowSwapOrderStatus', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it('GETs /api/v1/orders/{uid} and returns status plus optional fill fields', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      status: 'filled',
      txHash: '0xsettle',
      executedBuyAmount: '42',
    })

    await expect(
      getCowSwapOrderStatus({
        apiBase: 'https://api.cow.fi/mainnet',
        uid: '0xuid',
      })
    ).resolves.toEqual({
      status: 'filled',
      txHash: '0xsettle',
      executedBuyAmount: '42',
    })

    expect(queryUrl).toHaveBeenCalledWith('https://api.cow.fi/mainnet/api/v1/orders/0xuid')
  })
})
