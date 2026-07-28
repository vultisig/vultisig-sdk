import { describe, expect, it, vi } from 'vitest'

import { Chain } from '../../Chain'
import { getCosmosGasLimit } from './cosmosGasLimitRecord'
import {
  cosmosGasRecord,
  getCosmosFeeAmount,
  getCosmosSendFeeBaseUnits,
  getFeeAmountFromGasPrice,
  getMinGasPriceForDenom,
  MAYA_SEND_FEE_BASE_UNITS,
  TERRA_CLASSIC_ULUNA_BASE_GAS,
} from './gas'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

const mockFetch = (body: unknown, status = 200) =>
  vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch

describe('getCosmosSendFeeBaseUnits', () => {
  it('returns every existing IBC chain fee from the canonical record', () => {
    for (const [chain, fee] of Object.entries(cosmosGasRecord)) {
      expect(getCosmosSendFeeBaseUnits(chain as keyof typeof cosmosGasRecord)).toBe(fee)
    }
  })

  it('returns Maya fixed fee and leaves dynamic THORChain fee unresolved', () => {
    expect(getCosmosSendFeeBaseUnits(Chain.MayaChain)).toBe(MAYA_SEND_FEE_BASE_UNITS)
    expect(getCosmosSendFeeBaseUnits(Chain.THORChain)).toBeUndefined()
  })
})

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
      {
        fetchImpl: mockFetch({
          minimum_gas_price: '0.005000000000000000uatom',
        }),
      }
    )

    expect(fee).toBe(cosmosGasRecord[Chain.Cosmos])
  })

  it('raises the fee when live min gas requires more than the static floor', async () => {
    const fee = await getCosmosFeeAmount(
      { chain: Chain.Cosmos },
      {
        fetchImpl: mockFetch({
          minimum_gas_price: '0.100000000000000000uatom',
        }),
      }
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
      {
        fetchImpl: mockFetch({
          minimum_gas_price: '1000.000000000000000000uatom',
        }),
      }
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

  describe('Osmosis dynamic EIP-1559 base-fee floor', () => {
    // Osmosis's real minimum is enforced by its own x/txfees module
    // (queried separately from the generic node-config path above) - route
    // by URL so each request gets the right canned response.
    const routedFetch = (routes: Array<{ urlMatches: RegExp; body: unknown; status?: number }>) =>
      vi.fn(async (url: string) => {
        for (const r of routes) {
          if (r.urlMatches.test(url)) return jsonResponse(r.body, r.status ?? 200)
        }
        throw new Error(`unexpected fetch URL in test: ${url}`)
      }) as unknown as typeof fetch

    it('raises the fee above the generic-config result when the live base fee requires more', async () => {
      const fee = await getCosmosFeeAmount(
        { chain: Chain.Osmosis },
        {
          fetchImpl: routedFetch([
            // generic node config reports a low minimum-gas-price
            {
              urlMatches: /node\/v1beta1\/config/,
              body: { minimum_gas_price: '0.001000000000000000uosmo' },
            },
            // live-verified incident: base fee 0.03 required ~12000uosmo
            {
              urlMatches: /txfees\/v1beta1\/cur_eip_base_fee/,
              body: { base_fee: '0.03' },
            },
          ]),
        }
      )

      // 300_000 (Osmosis gas limit) * 0.03 * 1.25 headroom = 11250, well above
      // both the static floor (9000n) and the generic-config result (300).
      expect(fee).toBe(11_250n)
    })

    it('keeps the generic-config result when it already exceeds the dynamic floor', async () => {
      const fee = await getCosmosFeeAmount(
        { chain: Chain.Osmosis },
        {
          fetchImpl: routedFetch([
            {
              urlMatches: /node\/v1beta1\/config/,
              body: { minimum_gas_price: '0.200000000000000000uosmo' },
            },
            {
              urlMatches: /txfees\/v1beta1\/cur_eip_base_fee/,
              body: { base_fee: '0.001' },
            },
          ]),
        }
      )

      // generic path: 300_000 * 0.2 = 60_000 (above the 9000n static floor and
      // under the 90_000n (9000n * 10) anomaly-clamp threshold, so the live
      // value is used as-is), and above 300_000 * 0.001 * 1.25 = 375 from the
      // dynamic floor.
      expect(fee).toBe(60_000n)
    })

    it('falls back to the generic-config result when the Osmosis txfees endpoint is unreachable', async () => {
      const fee = await getCosmosFeeAmount(
        { chain: Chain.Osmosis },
        {
          fetchImpl: routedFetch([
            {
              urlMatches: /node\/v1beta1\/config/,
              body: { minimum_gas_price: '0.100000000000000000uosmo' },
            },
            {
              urlMatches: /txfees\/v1beta1\/cur_eip_base_fee/,
              body: {},
              status: 500,
            },
          ]),
        }
      )

      expect(fee).toBe(30_000n) // 300_000 * 0.1, generic path unaffected
    })

    it('does not query the Osmosis txfees endpoint for any other cosmos chain', async () => {
      const fetchImpl = vi.fn(async (url: string) => {
        if (/txfees\/v1beta1\/cur_eip_base_fee/.test(url)) {
          throw new Error('Cosmos Hub must never hit the Osmosis-only txfees endpoint')
        }
        return jsonResponse({ minimum_gas_price: '0.005000000000000000uatom' })
      }) as unknown as typeof fetch

      const fee = await getCosmosFeeAmount({ chain: Chain.Cosmos }, { fetchImpl })

      expect(fee).toBe(cosmosGasRecord[Chain.Cosmos])
    })

    it('falls back to the generic-config result when the dynamic floor exceeds its own sanity ceiling', async () => {
      // A pathological base_fee ("1000") would compute a ~375 OSMO dynamic
      // floor - getOsmosisDynamicFeeFloor discards it (returns null) rather
      // than feed it into the signable fee, so the generic-config result
      // (itself already computed and clamped) is used as-is.
      const fee = await getCosmosFeeAmount(
        { chain: Chain.Osmosis },
        {
          fetchImpl: routedFetch([
            {
              urlMatches: /node\/v1beta1\/config/,
              body: { minimum_gas_price: '0.100000000000000000uosmo' },
            },
            {
              urlMatches: /txfees\/v1beta1\/cur_eip_base_fee/,
              body: { base_fee: '1000' },
            },
          ]),
        }
      )

      expect(fee).toBe(30_000n) // generic path only: 300_000 * 0.1
    })

    it('does not throw through the public getCosmosFeeAmount/Promise.all surface on a pathologically large base_fee', async () => {
      // Codex review: the ORIGINAL crash reproduction was at this public
      // wrapper (Promise.all propagating a BigInt(Infinity) RangeError out
      // of getCosmosFeeAmount), not just the internal dynamic-floor helper.
      // Pin the fix at the surface the bug actually manifested on.
      const hugeButValid = '9'.repeat(400)
      const fee = await getCosmosFeeAmount(
        { chain: Chain.Osmosis },
        {
          fetchImpl: routedFetch([
            {
              urlMatches: /node\/v1beta1\/config/,
              body: { minimum_gas_price: '0.100000000000000000uosmo' },
            },
            {
              urlMatches: /txfees\/v1beta1\/cur_eip_base_fee/,
              body: { base_fee: hugeButValid },
            },
          ]),
        }
      )

      expect(fee).toBe(30_000n) // dynamic floor discarded, generic path used
    })
  })
})

describe('TERRA_CLASSIC_ULUNA_BASE_GAS', () => {
  // The constant is `staticGasLimit × 28.325 uluna/gas`, but nothing in the type
  // system ties it to cosmosGasLimitRecord. If that limit is ever retuned, the
  // base gas would silently under- or over-price every LUNC send. Fail loudly
  // here instead.
  const ULUNA_GAS_PRICE_MILLI = 28_325n // 28.325, scaled by 1000 to stay integral

  it('equals the TerraClassic static gas limit priced at 28.325 uluna/gas', () => {
    const staticGasLimit = getCosmosGasLimit({ chain: Chain.TerraClassic, id: undefined })

    expect(TERRA_CLASSIC_ULUNA_BASE_GAS).toBe((staticGasLimit * ULUNA_GAS_PRICE_MILLI) / 1000n)
  })

  it('is the value cosmosGasRecord serves for TerraClassic', () => {
    expect(cosmosGasRecord[Chain.TerraClassic]).toBe(TERRA_CLASSIC_ULUNA_BASE_GAS)
  })

  it('matches iOS ulunaBaseGas / Android ULUNA_BASE_GAS', () => {
    expect(TERRA_CLASSIC_ULUNA_BASE_GAS).toBe(8_497_500n)
  })
})
