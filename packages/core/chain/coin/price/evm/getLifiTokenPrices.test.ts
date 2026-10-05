import { EvmChain } from '@vultisig/core-chain/Chain'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryUrl } = vi.hoisted(() => ({
  mockQueryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mockQueryUrl,
}))

import { getLifiTokenPrices } from './getLifiTokenPrices'

const vthorAddr = '0x815C23eCA83261b6Ec689b60Cc4a58b54BC24D8D'

describe('getLifiTokenPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prices tokens by contract, keyed by lowercase address', async () => {
    mockQueryUrl.mockResolvedValue({ priceUSD: '0.2978133871' })

    const lookup = await getLifiTokenPrices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(lookup.prices).toEqual({ [vthorAddr.toLowerCase()]: 0.2978133871 })
    expect(lookup.failedIds).toEqual([])
    expect(mockQueryUrl).toHaveBeenCalledWith(`https://li.quest/v1/token?chain=1&token=${vthorAddr}`)
  })

  it('reports a transport failure and omits an unlisted token', async () => {
    mockQueryUrl
      .mockRejectedValueOnce(
        new HttpResponseError({
          message: 'unlisted',
          status: 400,
          statusText: 'Bad Request',
          url: 'https://li.quest/v1/token',
          body: {},
        })
      )
      .mockRejectedValueOnce(
        new HttpResponseError({
          message: 'down',
          status: 503,
          statusText: 'Service Unavailable',
          url: 'https://li.quest/v1/token',
          body: {},
        })
      )

    const lookup = await getLifiTokenPrices({
      ids: ['0xdead', '0xbeef'],
      chain: EvmChain.Ethereum,
    })

    expect(lookup.prices).toEqual({})
    expect(lookup.failedIds).toEqual(['0xbeef'])
  })
})
