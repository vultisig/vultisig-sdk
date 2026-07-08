import { describe, expect, it, vi } from 'vitest'

import { getOsmosisDynamicFeeFloor } from './osmosisDynamicFee'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

const mockFetch = (body: unknown, status = 200) =>
  vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch

describe('getOsmosisDynamicFeeFloor', () => {
  it('floors the fee at gasLimit * base_fee * 1.25 headroom, ceil-rounded', async () => {
    const floor = await getOsmosisDynamicFeeFloor(300_000n, {
      fetchImpl: mockFetch({ base_fee: '0.03' }),
    })

    // 300_000 * 0.03 * 1.25 = 11250 exactly
    expect(floor).toBe(11_250n)
  })

  it('matches the live-verified production incident (base fee 0.03, required ~12000uosmo)', async () => {
    // Live-verified: "base fee was 0.03 -> required 12000uosmo" (broadcast code 13).
    const floor = await getOsmosisDynamicFeeFloor(300_000n, {
      fetchImpl: mockFetch({ base_fee: '0.03' }),
    })

    expect(floor).toBeGreaterThanOrEqual(11_250n) // the headroom-applied floor exceeds the bare requirement
  })

  it('ceil-rounds a fractional result', async () => {
    const floor = await getOsmosisDynamicFeeFloor(1n, {
      fetchImpl: mockFetch({ base_fee: '0.001' }),
    })

    // 1 * 0.001 * 1.25 = 0.00125 -> ceil to 1
    expect(floor).toBe(1n)
  })

  it('returns null (fail-open) when the LCD response is not ok', async () => {
    const floor = await getOsmosisDynamicFeeFloor(300_000n, {
      fetchImpl: mockFetch({ base_fee: '0.03' }, 500),
    })

    expect(floor).toBeNull()
  })

  it('returns null (fail-open) when base_fee is missing or malformed', async () => {
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({}) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: 'not-a-number' }) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: '-1' }) })).toBeNull()
  })

  it('returns null (fail-open) for non-string/loosely-coercible base_fee values, not Number()`s permissive coercion', async () => {
    // Number(null) === 0, Number('') === 0, Number([]) === 0, Number(true) === 1 -
    // a naive `Number(body.base_fee)` would silently accept all of these.
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: null }) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: '' }) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: [] }) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: true }) })).toBeNull()
    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl: mockFetch({ base_fee: '1e5' }) })).toBeNull()
  })

  it('returns null (fail-open) when the fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch

    expect(await getOsmosisDynamicFeeFloor(300_000n, { fetchImpl })).toBeNull()
  })

  it('returns null (fail-open) when the request times out', async () => {
    vi.useFakeTimers()

    try {
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }) as unknown as typeof fetch

      const promise = getOsmosisDynamicFeeFloor(300_000n, { fetchImpl })

      await vi.advanceTimersByTimeAsync(5_000)

      await expect(promise).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns null (fail-open) at the timeout even when fetch completely ignores the abort signal', async () => {
    vi.useFakeTimers()

    try {
      // A fetch impl that never settles and never listens for the abort
      // signal at all - the timeout must still resolve independently via
      // Promise.race, not rely on the fetch impl reacting to abort().
      const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch

      const promise = getOsmosisDynamicFeeFloor(300_000n, { fetchImpl })

      await vi.advanceTimersByTimeAsync(5_000)

      await expect(promise).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts an external abort signal', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch

    const promise = getOsmosisDynamicFeeFloor(300_000n, { fetchImpl, signal: controller.signal })
    controller.abort()

    await expect(promise).resolves.toBeNull()
  })
})
