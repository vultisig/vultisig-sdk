import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryUrl = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

import { resolve4ByteSelector } from '@/tools/evm/resolve4ByteSelector'

describe('resolve4ByteSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a known selector', async () => {
    mockQueryUrl.mockResolvedValue({
      count: 1,
      results: [{ text_signature: 'transfer(address,uint256)' }],
    })

    const result = await resolve4ByteSelector('0xa9059cbb')

    expect(result).toEqual(['transfer(address,uint256)'])
    expect(mockQueryUrl).toHaveBeenCalledWith(expect.stringContaining('hex_signature=0xa9059cbb'))
  })

  it('handles selector without 0x prefix', async () => {
    mockQueryUrl.mockResolvedValue({
      count: 1,
      results: [{ text_signature: 'approve(address,uint256)' }],
    })

    const result = await resolve4ByteSelector('095ea7b3')

    expect(result).toEqual(['approve(address,uint256)'])
    expect(mockQueryUrl).toHaveBeenCalledWith(expect.stringContaining('hex_signature=0x095ea7b3'))
  })

  it('returns multiple matches for ambiguous selectors', async () => {
    mockQueryUrl.mockResolvedValue({
      count: 2,
      results: [{ text_signature: 'transfer(address,uint256)' }, { text_signature: 'transfer(bytes32,uint256)' }],
    })

    const result = await resolve4ByteSelector('0xa9059cbb')

    expect(result).toHaveLength(2)
  })

  it('returns empty array for unknown selector', async () => {
    mockQueryUrl.mockResolvedValue({
      count: 0,
      results: [],
    })

    const result = await resolve4ByteSelector('0xdeadbeef')

    expect(result).toEqual([])
  })

  it('returns empty array on API failure', async () => {
    mockQueryUrl.mockResolvedValue(null)

    const result = await resolve4ByteSelector('0xa9059cbb')

    expect(result).toEqual([])
  })
})
