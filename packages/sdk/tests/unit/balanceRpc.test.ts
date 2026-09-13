import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson } from '../../src/tools/balance/rpc'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('balance rpc fetchJson', () => {
  it('sdk#1344 review: a stalled response body (resolves after headers) is still bounded by the timeout', async () => {
    // Reproduces the exact gap the review found: withFetchTimeout clears its
    // timer once `consume` settles, so a body read that happens OUTSIDE
    // consume runs with no deadline. Pins that the body read now happens
    // INSIDE consume by proving a body that never resolves still bounds the
    // call to DEFAULT_TIMEOUT_MS (15_000ms), not indefinitely.
    vi.useFakeTimers()
    try {
      const stalledJson = new Promise(() => {
        /* never resolves — simulates a stalled response body */
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => stalledJson,
      } as unknown as Response)

      const promise = fetchJson('https://example.test')
      const assertion = expect(promise).rejects.toThrow(/timeout/i)

      // Let the microtask queue settle so fetch() resolves and consume()
      // starts awaiting the stalled json() promise before advancing time.
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(15_000)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not depend on AbortSignal.timeout at runtime', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as unknown as Response)

    const originalTimeout = AbortSignal.timeout
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
    try {
      await expect(fetchJson('https://example.test')).resolves.toEqual({ ok: true })
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', { value: originalTimeout, configurable: true })
    }
  })
})
