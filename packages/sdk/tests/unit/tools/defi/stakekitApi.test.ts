import { afterEach, describe, expect, it, vi } from 'vitest'

import { searchYields } from '@/tools/defi/stakekit/stakekitApi'

describe('searchYields — /yields/enabled cache is API-key scoped', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('does NOT share a cached result between two different API keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'yield-for-key-a' }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'yield-for-key-b' }] }),
      } as Response)
    globalThis.fetch = fetchMock

    const resultA = await searchYields({ apiKey: 'key-a', network: 'ethereum' })
    const resultB = await searchYields({ apiKey: 'key-b', network: 'ethereum' })

    // Same query params (network: ethereum), DIFFERENT API keys — must hit the
    // network twice, never serve key-b from key-a's cached enabled-product set.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((resultA[0] as { id: string }).id).toBe('yield-for-key-a')
    expect((resultB[0] as { id: string }).id).toBe('yield-for-key-b')
  })

  it('does NOT share a cached result between an API key and the public (no-key) bucket', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'yield-for-key-c' }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'yield-public' }] }),
      } as Response)
    globalThis.fetch = fetchMock

    const keyed = await searchYields({ apiKey: 'key-c', network: 'avalanche-c' })
    const anon = await searchYields({ network: 'avalanche-c' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((keyed[0] as { id: string }).id).toBe('yield-for-key-c')
    expect((anon[0] as { id: string }).id).toBe('yield-public')
  })

  it('DOES reuse the cache for the SAME API key + query (no redundant network call)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'yield-x' }] }),
    } as Response)
    globalThis.fetch = fetchMock

    const first = await searchYields({ apiKey: 'key-d', network: 'solana' })
    const second = await searchYields({ apiKey: 'key-d', network: 'solana' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first) // same cached array reference
  })
})
