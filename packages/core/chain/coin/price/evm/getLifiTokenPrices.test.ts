import { EvmChain } from '@vultisig/core-chain/Chain'
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

    const prices = await getLifiTokenPrices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({ [vthorAddr.toLowerCase()]: 0.2978133871 })
    expect(mockQueryUrl).toHaveBeenCalledWith(`https://li.quest/v1/token?chain=1&token=${vthorAddr}`)
  })

  it('omits tokens LiFi cannot price and swallows per-token failures', async () => {
    mockQueryUrl.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({ priceUSD: '0' })

    const prices = await getLifiTokenPrices({
      ids: ['0xdead', '0xbeef'],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({})
  })
})
