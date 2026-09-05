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
      witness_address: '41' + '03'.repeat(20),
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
  it.each([null, [], 'bad', {}, { block_header: {} }, { block_header: { raw_data: null } }])(
    'rejects a missing or malformed header: %j',
    async response => {
      mocks.queryUrl.mockResolvedValue(response)
      await expect(getTronBlockInfo({})).rejects.toThrow('Invalid Tron block response')
    }
  )

  it.each(['Error', 'error'])('rejects a %s envelope even alongside a valid header', async field => {
    mocks.queryUrl.mockResolvedValue({ ...block, [field]: 'gateway failed' })
    await expect(getTronBlockInfo({})).rejects.toThrow('RPC error envelope')
  })

  const malformedFields = [
    ...['timestamp', 'number', 'version', 'txTrieRoot', 'parentHash', 'witness_address'].flatMap(field =>
      [undefined, null, '', false, {}].map(value => ({ field, value }))
    ),
    ...['timestamp', 'number', 'version'].flatMap(field =>
      [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '123'].map(value => ({ field, value }))
    ),
    { field: 'timestamp', value: 0 },
    { field: 'version', value: 0x80000000 },
    ...['txTrieRoot', 'parentHash'].flatMap(field =>
      ['ab', 'g'.repeat(64), '0x' + 'ab'.repeat(32)].map(value => ({ field, value }))
    ),
    { field: 'witness_address', value: '03'.repeat(21) },
  ]

  it.each(malformedFields)('rejects invalid $field: $value', async ({ field, value }) => {
    mocks.queryUrl.mockResolvedValue({
      ...block,
      block_header: { raw_data: { ...block.block_header.raw_data, [field]: value } },
    })
    await expect(getTronBlockInfo({})).rejects.toThrow(`block_header.raw_data.${field}`)
  })

  const refInput = { refBlockBytesHex: '0001', refBlockHashHex: 'abcdef0123456789' }
  const referenceBlock = {
    blockID: '00'.repeat(8) + refInput.refBlockHashHex + '00'.repeat(16),
    block_header: {
      raw_data: { ...block.block_header.raw_data, number: 98_959_361, timestamp: blockTimestamp - 3000 },
    },
  }

  it('preserves complete reference data and overrides across candidate windows', async () => {
    mocks.queryUrl.mockResolvedValueOnce(block).mockResolvedValueOnce(block).mockResolvedValueOnce(referenceBlock)
    await expect(getTronBlockInfo({ ...refInput, timestamp: 123, expiration: 456 })).resolves.toEqual({
      timestamp: 123,
      expiration: 456,
      blockHeaderTimestamp: blockTimestamp - 3000,
      blockHeaderNumber: referenceBlock.block_header.raw_data.number,
      blockHeaderVersion: 30,
      blockHeaderTxTrieRoot: block.block_header.raw_data.txTrieRoot,
      blockHeaderParentHash: block.block_header.raw_data.parentHash,
      blockHeaderWitnessAddress: block.block_header.raw_data.witness_address,
    })
    const candidate = Math.floor(block.block_header.raw_data.number / 65536) * 65536 + 1
    expect(mocks.queryUrl.mock.calls.slice(1).map(([, options]) => options.body.num)).toEqual([
      candidate,
      candidate - 65536,
    ])
  })

  it.each([
    { Error: 'failed' },
    { error: 'failed' },
    {},
    { ...referenceBlock, block_header: { raw_data: { timestamp: blockTimestamp } } },
    ...[undefined, null, 42, '', 'zz'.repeat(32), 'ab'.repeat(16)].map(blockID => ({ ...referenceBlock, blockID })),
  ])('rejects malformed reference responses before resolving signing data: %j', async response => {
    mocks.queryUrl.mockResolvedValueOnce(block).mockResolvedValueOnce(response)
    await expect(getTronBlockInfo(refInput)).rejects.toThrow('Invalid Tron block response')
    expect(mocks.queryUrl).toHaveBeenCalledTimes(2)
  })

  it('fails after three complete but nonmatching reference blocks', async () => {
    await expect(getTronBlockInfo(refInput)).rejects.toThrow('Could not resolve ref block')
    expect(mocks.queryUrl).toHaveBeenCalledTimes(4)
  })
})
