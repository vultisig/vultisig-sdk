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

const nowBlockUrl = expect.stringContaining('/wallet/getnowblock')
const blockByNumUrl = expect.stringContaining('/wallet/getblockbynum')

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

  it('returns every header field verbatim from a complete block', async () => {
    await expect(getTronBlockInfo({})).resolves.toEqual({
      timestamp: blockTimestamp,
      expiration: blockTimestamp + 60 * 60 * 1000,
      blockHeaderTimestamp: blockTimestamp,
      blockHeaderNumber: 99_000_000,
      blockHeaderVersion: 30,
      blockHeaderTxTrieRoot: '01'.repeat(32),
      blockHeaderParentHash: '02'.repeat(32),
      blockHeaderWitnessAddress: '03'.repeat(21),
    })
  })

  describe('incomplete getnowblock responses (#2270)', () => {
    it('surfaces the gateway message from a capital-E `Error` envelope on HTTP 200', async () => {
      mocks.queryUrl.mockResolvedValue({
        Error: 'class org.tron.core.exception.JsonRpcInvalidRequestException',
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        'getnowblock failed: class org.tron.core.exception.JsonRpcInvalidRequestException'
      )
    })

    it('surfaces the gateway message from a lowercase `error` envelope', async () => {
      mocks.queryUrl.mockResolvedValue({ error: 'upstream unavailable' })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock failed: upstream unavailable')
    })

    it('rejects a response without block_header.raw_data', async () => {
      mocks.queryUrl.mockResolvedValue({ blockID: '00'.repeat(32) })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response missing block_header.raw_data')
    })

    it('rejects a response without blockID', async () => {
      mocks.queryUrl.mockResolvedValue({ block_header: block.block_header })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response missing block_header.raw_data')
    })

    it('rejects a partial raw_data instead of zeroing the TAPOS header', async () => {
      mocks.queryUrl.mockResolvedValue({
        blockID: '00'.repeat(32),
        block_header: { raw_data: { timestamp: blockTimestamp } },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        'getnowblock: block_header.raw_data missing number, version, txTrieRoot, parentHash, witness_address'
      )
    })

    it('rejects when a single header field is null', async () => {
      mocks.queryUrl.mockResolvedValue({
        ...block,
        block_header: {
          raw_data: { ...block.block_header.raw_data, txTrieRoot: null },
        },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: block_header.raw_data missing txTrieRoot')
    })
  })

  describe('ref block resolution', () => {
    // 99_000_000 = 1510 * 65536 + 40_640, so a ref block with low bits 0x3f40 (16_192)
    // snaps to 1510 * 65536 + 16_192 = 98_975_552.
    const refBlockBytesHex = '3f40'
    const refBlockHashHex = 'ab'.repeat(8)
    const refBlock = {
      ...block,
      blockID: '00'.repeat(8) + refBlockHashHex + '00'.repeat(16),
      block_header: {
        raw_data: {
          ...block.block_header.raw_data,
          number: 98_975_552,
          timestamp: blockTimestamp - 1,
        },
      },
    }

    it('returns the resolved ref block header', async () => {
      mocks.queryUrl.mockImplementation(async (url: string) => (url.includes('getblockbynum') ? refBlock : block))

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).resolves.toMatchObject({
        blockHeaderNumber: 98_975_552,
        blockHeaderTimestamp: blockTimestamp - 1,
      })
      expect(mocks.queryUrl).toHaveBeenCalledWith(nowBlockUrl, expect.anything())
      expect(mocks.queryUrl).toHaveBeenCalledWith(blockByNumUrl, expect.objectContaining({ body: { num: 98_975_552 } }))
    })

    it('rejects a partial getblockbynum response instead of zeroing the header', async () => {
      mocks.queryUrl.mockImplementation(async (url: string) =>
        url.includes('getblockbynum')
          ? {
              blockID: refBlock.blockID,
              block_header: { raw_data: { timestamp: blockTimestamp } },
            }
          : block
      )

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).rejects.toThrow(
        'getblockbynum: block_header.raw_data missing number, version, txTrieRoot, parentHash, witness_address'
      )
    })

    it('surfaces a gateway error envelope from getblockbynum', async () => {
      mocks.queryUrl.mockImplementation(async (url: string) =>
        url.includes('getblockbynum') ? { Error: 'block not found' } : block
      )

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).rejects.toThrow(
        'getblockbynum failed: block not found'
      )
    })
  })
})
