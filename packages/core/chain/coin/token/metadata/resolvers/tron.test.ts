import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { encodeAbiParameters } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTronTokenMetadata } from './tron'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))
const token = { chain: Chain.Tron, id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } as const

describe('getTronTokenMetadata', () => {
  beforeEach(() => vi.resetAllMocks())

  it.each(['USDT', 'Wrapped TRX with a symbol longer than one ABI word', '币'])(
    'decodes dynamic ABI symbol %s and hexadecimal decimals',
    async ticker => {
      vi.mocked(queryUrl)
        .mockResolvedValueOnce({ constant_result: [encodeAbiParameters([{ type: 'string' }], [ticker]).slice(2)] })
        .mockResolvedValueOnce({ constant_result: ['12'.padStart(64, '0')] })
      await expect(getTronTokenMetadata(token)).resolves.toEqual({ ticker, decimals: 18 })
      expect(queryUrl).toHaveBeenCalledTimes(2)
      for (const function_selector of ['symbol()', 'decimals()']) {
        expect(queryUrl).toHaveBeenCalledWith('https://api.trongrid.io/wallet/triggerconstantcontract', {
          body: {
            contract_address: token.id,
            function_selector,
            owner_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
            visible: true,
          },
        })
      }
    }
  )

  it('decodes a short null-padded symbol and zero decimals', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({ constant_result: ['205452582000'.padEnd(64, '0')] })
      .mockResolvedValueOnce({ constant_result: ['0'.repeat(64)] })
    await expect(getTronTokenMetadata(token)).resolves.toEqual({ ticker: 'TRX', decimals: 0 })
  })

  it.each([{}, { constant_result: [] }, { constant_result: [''] }])('rejects missing symbol %j', async response => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ constant_result: ['06'] })
    await expect(getTronTokenMetadata(token)).rejects.toThrow(`Failed to fetch symbol for token ${token.id}`)
  })

  it.each([{}, { constant_result: [] }, { constant_result: [''] }])('rejects missing decimals %j', async response => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({ constant_result: ['545258'] })
      .mockResolvedValueOnce(response)
    await expect(getTronTokenMetadata(token)).rejects.toThrow(`Failed to fetch decimals for token ${token.id}`)
  })

  it.each([0, 1])('propagates failure from metadata call %i', async failedCall => {
    const error = new Error('constant contract failed')
    vi.mocked(queryUrl)
      .mockImplementationOnce(async () => {
        if (failedCall === 0) throw error
        return { constant_result: ['545258'] }
      })
      .mockImplementationOnce(async () => {
        throw error
      })
    await expect(getTronTokenMetadata(token)).rejects.toBe(error)
  })
})
