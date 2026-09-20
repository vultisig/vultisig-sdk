import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryTron: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/tron/queryTron', () => ({
  queryTron: mocks.queryTron,
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

const nowBlockPath = '/wallet/getnowblock'
const blockByNumPath = '/wallet/getblockbynum'

describe('getTronBlockInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.queryTron.mockResolvedValue(block)
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
      blockHeaderWitnessAddress: '41' + '03'.repeat(20),
    })
  })

  describe('incomplete getnowblock responses (#2270)', () => {
    it('surfaces the gateway message from a capital-E `Error` envelope on HTTP 200', async () => {
      mocks.queryTron.mockResolvedValue({
        Error: 'class org.tron.core.exception.JsonRpcInvalidRequestException',
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        'getnowblock failed: class org.tron.core.exception.JsonRpcInvalidRequestException'
      )
    })

    it('surfaces the gateway message from a lowercase `error` envelope', async () => {
      mocks.queryTron.mockResolvedValue({ error: 'upstream unavailable' })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock failed: upstream unavailable')
    })

    it('rejects a response without block_header.raw_data', async () => {
      mocks.queryTron.mockResolvedValue({ blockID: '00'.repeat(32) })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response missing block_header.raw_data')
    })

    it('rejects a response without blockID', async () => {
      mocks.queryTron.mockResolvedValue({ block_header: block.block_header })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response missing block_header.raw_data')
    })

    it('rejects a partial raw_data instead of zeroing the TAPOS header', async () => {
      mocks.queryTron.mockResolvedValue({
        blockID: '00'.repeat(32),
        block_header: { raw_data: { timestamp: blockTimestamp } },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        'getnowblock: block_header.raw_data missing or invalid number, version, txTrieRoot, parentHash, witness_address'
      )
    })

    it('rejects when a single header field is null', async () => {
      mocks.queryTron.mockResolvedValue({
        ...block,
        block_header: {
          raw_data: { ...block.block_header.raw_data, txTrieRoot: null },
        },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        'getnowblock: block_header.raw_data missing or invalid txTrieRoot'
      )
    })

    it.each([
      ['null', null],
      ['a string', 'ok'],
      ['a number', 200],
    ])('rejects a %s body instead of dereferencing it', async (_label, body) => {
      mocks.queryTron.mockResolvedValue(body)

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response is not an object')
    })

    it('rejects an empty blockID', async () => {
      mocks.queryTron.mockResolvedValue({ ...block, blockID: '' })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock: response missing block_header.raw_data')
    })

    it.each([
      ['a string timestamp', { timestamp: String(blockTimestamp) }, 'timestamp'],
      ['a NaN block number', { number: Number.NaN }, 'number'],
      ['an Infinity version', { version: Number.POSITIVE_INFINITY }, 'version'],
      // `BigInt(1.5)` throws in the keysign resolver and `Long.fromNumber`
      // silently truncates above MAX_SAFE_INTEGER, so only integers may pass.
      ['a fractional timestamp', { timestamp: blockTimestamp + 0.5 }, 'timestamp'],
      ['a negative timestamp', { timestamp: -1 }, 'timestamp'],
      ['an unsafe-integer timestamp', { timestamp: Number.MAX_SAFE_INTEGER + 2 }, 'timestamp'],
      ['a fractional block number', { number: 99_000_000.25 }, 'number'],
      ['a negative block number', { number: -99_000_000 }, 'number'],
      ['an unsafe-integer block number', { number: 2 ** 53 }, 'number'],
      ['a fractional version', { version: 30.5 }, 'version'],
      ['a negative version', { version: -1 }, 'version'],
      ['a version above int32', { version: 0x7fffffff + 1 }, 'version'],
      ['an empty txTrieRoot', { txTrieRoot: '' }, 'txTrieRoot'],
      ['an empty parentHash', { parentHash: '' }, 'parentHash'],
      ['a numeric witness_address', { witness_address: 42 }, 'witness_address'],
      // `Buffer.from('zz', 'hex')` is empty and a trailing odd nibble is
      // dropped, so these would otherwise reach signing as a malformed header.
      ['a non-hex txTrieRoot', { txTrieRoot: 'zz'.repeat(32) }, 'txTrieRoot'],
      ['a txTrieRoot with a non-hex tail', { txTrieRoot: '01'.repeat(31) + 'zz' }, 'txTrieRoot'],
      ['a short txTrieRoot', { txTrieRoot: '01'.repeat(31) }, 'txTrieRoot'],
      ['an odd-length txTrieRoot', { txTrieRoot: '01'.repeat(32) + '1' }, 'txTrieRoot'],
      ['a 0x-prefixed txTrieRoot', { txTrieRoot: '0x' + '01'.repeat(31) }, 'txTrieRoot'],
      ['a long parentHash', { parentHash: '02'.repeat(33) }, 'parentHash'],
      ['a short parentHash', { parentHash: '02'.repeat(16) }, 'parentHash'],
      ['a non-hex witness_address', { witness_address: 'g'.repeat(42) }, 'witness_address'],
      ['a 20-byte witness_address', { witness_address: '03'.repeat(20) }, 'witness_address'],
      ['a 21-byte witness_address without the 41 prefix', { witness_address: '03'.repeat(21) }, 'witness_address'],
      ['a 22-byte witness_address', { witness_address: '41' + '03'.repeat(21) }, 'witness_address'],
      ['a base58 witness_address', { witness_address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' }, 'witness_address'],
    ])('rejects %s', async (_label, override, field) => {
      mocks.queryTron.mockResolvedValue({
        ...block,
        block_header: {
          raw_data: { ...block.block_header.raw_data, ...override },
        },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow(
        `getnowblock: block_header.raw_data missing or invalid ${field}`
      )
    })

    it('accepts upper-case hex header fields', async () => {
      mocks.queryTron.mockResolvedValue({
        ...block,
        block_header: {
          raw_data: {
            ...block.block_header.raw_data,
            txTrieRoot: 'AB'.repeat(32),
            parentHash: 'CD'.repeat(32),
            witness_address: '41' + 'EF'.repeat(20),
          },
        },
      })

      await expect(getTronBlockInfo({})).resolves.toMatchObject({
        blockHeaderTxTrieRoot: 'AB'.repeat(32),
        blockHeaderParentHash: 'CD'.repeat(32),
        blockHeaderWitnessAddress: '41' + 'EF'.repeat(20),
      })
    })

    it('does not treat an empty error field as a failure', async () => {
      mocks.queryTron.mockResolvedValue({ ...block, Error: '' })

      await expect(getTronBlockInfo({})).resolves.toMatchObject({
        blockHeaderNumber: 99_000_000,
      })
    })

    it('serialises a non-string error envelope', async () => {
      mocks.queryTron.mockResolvedValue({
        error: { code: 503, message: 'busy' },
      })

      await expect(getTronBlockInfo({})).rejects.toThrow('getnowblock failed: {"code":503,"message":"busy"}')
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
      mocks.queryTron.mockImplementation(async (url: string) => (url.includes('getblockbynum') ? refBlock : block))

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).resolves.toMatchObject({
        blockHeaderNumber: 98_975_552,
        blockHeaderTimestamp: blockTimestamp - 1,
      })
      expect(mocks.queryTron).toHaveBeenCalledWith(nowBlockPath, expect.anything())
      expect(mocks.queryTron).toHaveBeenCalledWith(
        blockByNumPath,
        expect.objectContaining({ body: { num: 98_975_552 } })
      )
    })

    it('rejects a partial getblockbynum response instead of zeroing the header', async () => {
      mocks.queryTron.mockImplementation(async (url: string) =>
        url.includes('getblockbynum')
          ? {
              blockID: refBlock.blockID,
              block_header: { raw_data: { timestamp: blockTimestamp } },
            }
          : block
      )

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).rejects.toThrow(
        'getblockbynum: block_header.raw_data missing or invalid number, version, txTrieRoot, parentHash, witness_address'
      )
    })

    it('surfaces a gateway error envelope from getblockbynum', async () => {
      mocks.queryTron.mockImplementation(async (url: string) =>
        url.includes('getblockbynum') ? { Error: 'block not found' } : block
      )

      await expect(getTronBlockInfo({ refBlockBytesHex, refBlockHashHex })).rejects.toThrow(
        'getblockbynum failed: block not found'
      )
    })
  })
})
