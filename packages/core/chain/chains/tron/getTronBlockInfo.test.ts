import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { getTronBlockInfo } from './getTronBlockInfo'

const blockTimestamp = 1_716_000_000_000
const block = {
  blockID: '00'.repeat(32),
  block_header: {
    raw_data: {
      timestamp: blockTimestamp,
      number: 99_000_000,
      version: 30,
      txTrieRoot: '01'.repeat(32),
      parentHash: '02'.repeat(32),
      witness_address: '03'.repeat(21),
    },
  },
}

describe('getTronBlockInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.queryUrl.mockResolvedValue(block)
  })

  it('derives default timestamp and expiration from the fetched block header', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(blockTimestamp + 123_456)

    await expect(getTronBlockInfo({})).resolves.toMatchObject({
      timestamp: blockTimestamp,
      expiration: blockTimestamp + 60 * 60 * 1000,
      blockHeaderTimestamp: blockTimestamp,
    })
  })

  it('preserves explicit timestamp and expiration overrides', async () => {
    await expect(
      getTronBlockInfo({
        timestamp: 1_800_000_000_000,
        expiration: 1_800_000_100_000,
      })
    ).resolves.toMatchObject({
      timestamp: 1_800_000_000_000,
      expiration: 1_800_000_100_000,
      blockHeaderTimestamp: blockTimestamp,
    })
  })
})
