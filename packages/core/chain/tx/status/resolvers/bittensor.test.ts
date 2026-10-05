import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queryUrl: vi.fn() }))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: mocks.queryUrl }))

import { OtherChain } from '../../../Chain'
import { getBittensorTxStatus } from './bittensor'

const hash = '0x' + 'a'.repeat(64)
const emptyPagination = {
  current_page: 1,
  per_page: 50,
  total_items: 0,
  total_pages: 0,
  next_page: null,
  prev_page: null,
}

describe('getBittensorTxStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports not_found when Taostats returns an empty data array', async () => {
    mocks.queryUrl.mockResolvedValue({ pagination: emptyPagination, data: [] })

    await expect(getBittensorTxStatus({ chain: OtherChain.Bittensor, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('keeps a transient Taostats failure pending', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('gateway unavailable'))

    await expect(getBittensorTxStatus({ chain: OtherChain.Bittensor, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it.each([
    [true, 'success'],
    [false, 'error'],
  ] as const)('reports indexed success=%s as %s', async (success, status) => {
    mocks.queryUrl.mockResolvedValue({
      pagination: { ...emptyPagination, total_items: 1, total_pages: 1 },
      data: [{ hash, block_number: 5_123_456, success, fee: '125000', timestamp: '2026-09-30T00:00:00Z' }],
    })

    await expect(getBittensorTxStatus({ chain: OtherChain.Bittensor, hash })).resolves.toMatchObject({ status })
  })
})
