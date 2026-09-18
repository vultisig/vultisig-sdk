import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson } from '../../../../src/tools/balance/rpc'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchJson', () => {
  it('returns the parsed JSON body on a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    } as unknown as Response)

    await expect(fetchJson('https://example.test/api')).resolves.toEqual({ hello: 'world' })
  })

  // Regression for sdk#1343: fetchJson previously called `AbortSignal.timeout`
  // directly, which doesn't exist on older RN/Hermes runtimes. Deleting it
  // from the global simulates that environment — reads must still succeed via
  // the Hermes-safe AbortController + setTimeout fallback, and a caller-
  // supplied `init.signal` must still take precedence over the default.
  it('succeeds without AbortSignal.timeout available (Hermes simulation)', async () => {
    const original = globalThis.AbortSignal.timeout
    // @ts-expect-error — simulating a runtime that lacks this static method
    delete globalThis.AbortSignal.timeout
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ hello: 'hermes' }),
      } as unknown as Response)

      await expect(fetchJson('https://example.test/api')).resolves.toEqual({ hello: 'hermes' })
    } finally {
      globalThis.AbortSignal.timeout = original
    }
  })

  it('retries once on a network TypeError and then succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as unknown as Response)

    await expect(fetchJson('https://example.test/api')).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx client error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as unknown as Response)

    await expect(fetchJson('https://example.test/api')).rejects.toThrow(/HTTP 404/)
  })

  it('honours a caller-supplied init.signal instead of building its own timeout controller', async () => {
    const controller = new AbortController()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as unknown as Response)

    await fetchJson('https://example.test/api', undefined, { signal: controller.signal })

    const passedInit = fetchSpy.mock.calls[0][1] as RequestInit
    expect(passedInit.signal).toBe(controller.signal)
  })
})
