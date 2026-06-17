import { describe, expect, it, vi } from 'vitest'

import { Chain } from '../../Chain'
import { cosmosGasRecord, getCosmosFeeAmount, getFeeAmountFromGasPrice, getMinGasPriceForDenom } from './gas'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

const mockFetch = (body: unknown, status = 200) =>
  vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch

describe('getFeeAmountFromGasPrice', () => {
  it('ceil-rounds fractional fee amounts', () => {
    expect(
      getFeeAmountFromGasPrice(200_000n, {
        numerator: 1_000_001n,
        denominator: 1_000_000n,
      })
    ).toBe(200_001n)
  })
})

describe('getMinGasPriceForDenom', () => {
  it('selects the matching fee denom from multi-denom node configs', () => {
    expect(
      getMinGasPriceForDenom(
        '1000000.000000000000000000ausdy,0.100000000000000000uusdc,0.090000000000000000ueure',
        'uusdc'
      )
    ).toEqual({
      numerator: 100_000_000_000_000_000n,
      denominator: 1_000_000_000_000_000_000n,
    })
  })

  it('ignores blank or malformed config entries', () => {
    expect(getMinGasPriceForDenom('', 'uatom')).toBeUndefined()
    expect(getMinGasPriceForDenom('not-a-price,0.01uosmo', 'uatom')).toBeUndefined()
  })
})

describe('getCosmosFeeAmount', () => {
  it('keeps the static fee floor when live min gas computes lower', async () => {
    const fee = await getCosmosFeeAmount(
      { chain: Chain.Cosmos },
      { fetchImpl: mockFetch({ minimum_gas_price: '0.005000000000000000uatom' }) }
    )

    expect(fee).toBe(cosmosGasRecord[Chain.Cosmos])
  })

  it('raises the fee when live min gas requires more than the static floor', async () => {
    const fee = await getCosmosFeeAmount(
      { chain: Chain.Cosmos },
      { fetchImpl: mockFetch({ minimum_gas_price: '0.100000000000000000uatom' }) }
    )

    expect(fee).toBe(20_000n)
  })

  it('uses the chain fee denom when the node reports multiple gas prices', async () => {
    const fee = await getCosmosFeeAmount(
      { chain: Chain.Noble },
      {
        fetchImpl: mockFetch({
          minimum_gas_price: '1000000.000000000000000000ausdy,0.200000000000000000uusdc',
        }),
      }
    )

    expect(fee).toBe(40_000n)
  })

  it('falls back to the static fee when live min gas computes an implausibly high fee', async () => {
    const fee = await getCosmosFeeAmount(
      { chain: Chain.Cosmos },
      { fetchImpl: mockFetch({ minimum_gas_price: '1000.000000000000000000uatom' }) }
    )

    expect(fee).toBe(cosmosGasRecord[Chain.Cosmos])
  })

  it('falls back to the static fee when the node config cannot be read', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('LCD unavailable')
    }) as unknown as typeof fetch

    const fee = await getCosmosFeeAmount({ chain: Chain.Akash }, { fetchImpl })

    expect(fee).toBe(cosmosGasRecord[Chain.Akash])
  })

  it('falls back to the static fee when the node config request times out', async () => {
    vi.useFakeTimers()

    try {
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }) as unknown as typeof fetch

      const promise = getCosmosFeeAmount({ chain: Chain.Cosmos }, { fetchImpl })

      await vi.advanceTimersByTimeAsync(3_000)

      await expect(promise).resolves.toBe(cosmosGasRecord[Chain.Cosmos])
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the static fee when fetch ignores the timeout signal', async () => {
    vi.useFakeTimers()

    try {
      const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch

      const promise = getCosmosFeeAmount({ chain: Chain.Cosmos }, { fetchImpl })

      await vi.advanceTimersByTimeAsync(3_000)

      await expect(promise).resolves.toBe(cosmosGasRecord[Chain.Cosmos])
    } finally {
      vi.useRealTimers()
    }
  })
})
