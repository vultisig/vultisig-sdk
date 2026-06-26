import { describe, expect, it, vi, afterEach } from 'vitest'

import { queryUrl } from './queryUrl'

const origFetch = global.fetch

afterEach(() => {
  global.fetch = origFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('queryUrl - default timeout (unbounded-fetch perma-load fix)', () => {
  it('aborts a hung fetch after the default deadline with a timeout error', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject((init.signal as AbortSignal).reason))
        }),
    ) as unknown as typeof fetch

    const p = queryUrl('https://api.example.com/coingeicko/api/v3/simple/price')
    const assertion = expect(p).rejects.toThrow(/timed out after 20000ms/i)
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })

  it('returns the parsed JSON when the fetch resolves in time (no false timeout)', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ethereum: { usd: 3000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch

    const res = await queryUrl<{ ethereum: { usd: number } }>('https://api.example.com/x')
    expect(res).toEqual({ ethereum: { usd: 3000 } })
  })

  it('passes a caller-supplied signal through and does NOT apply the default deadline', async () => {
    const controller = new AbortController()
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const res = await queryUrl<{ ok: number }>('https://api.example.com/x', { signal: controller.signal })
    expect(res).toEqual({ ok: 1 })
  })
})
