import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryUrl } = vi.hoisted(() => ({
  mockQueryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mockQueryUrl,
}))

import { queryCoingeickoPricesWithChange } from './queryCoingeickoPricesWithChange'

describe('queryCoingeickoPricesWithChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts both price and the <currency>_24h_change field', async () => {
    mockQueryUrl.mockResolvedValue({
      ethereum: { usd: 2067.1, usd_24h_change: -3.97 },
      bitcoin: { usd: 76923, usd_24h_change: -5.24 },
    })

    const result = await queryCoingeickoPricesWithChange({
      url: 'https://x/price',
      fiatCurrency: 'usd' as never,
    })

    expect(result.ethereum).toEqual({ price: 2067.1, change24h: -3.97 })
    expect(result.bitcoin).toEqual({ price: 76923, change24h: -5.24 })
  })

  it('omits change24h when CoinGecko has no datum for the id', async () => {
    mockQueryUrl.mockResolvedValue({
      'long-tail-token': { usd: 0.0001 },
    })

    const result = await queryCoingeickoPricesWithChange({
      url: 'https://x/price',
      fiatCurrency: 'usd' as never,
    })

    expect(result['long-tail-token']).toEqual({ price: 0.0001 })
    expect(result['long-tail-token']).not.toHaveProperty('change24h')
  })

  it('defaults a missing price to 0 (defensive — never NaN/undefined)', async () => {
    mockQueryUrl.mockResolvedValue({
      weird: { usd_24h_change: 1.2 },
    })

    const result = await queryCoingeickoPricesWithChange({
      url: 'https://x/price',
      fiatCurrency: 'usd' as never,
    })

    expect(result.weird).toEqual({ price: 0, change24h: 1.2 })
  })

  it('honors a non-usd fiat currency for both price and change keys', async () => {
    mockQueryUrl.mockResolvedValue({
      ethereum: { eur: 1900, eur_24h_change: -2.1 },
    })

    const result = await queryCoingeickoPricesWithChange({
      url: 'https://x/price',
      fiatCurrency: 'eur' as never,
    })

    expect(result.ethereum).toEqual({ price: 1900, change24h: -2.1 })
  })
})
