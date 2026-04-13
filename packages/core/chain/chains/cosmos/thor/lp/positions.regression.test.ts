/**
 * Regression test for codex review feedback:
 * - 200 response with non-array `pools` field must THROW, not silently
 *   return an empty array (which would mask schema drift).
 * - 200 response with an explicitly-missing `pools` key returns empty
 *   (legacy Midgard behavior).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getThorchainLpPositions } from './positions'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetch = (body: unknown) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

describe('getThorchainLpPositions schema regression guards', () => {
  it('throws when Midgard returns pools as a string (schema drift)', async () => {
    mockFetch({ pools: 'not an array' })
    await expect(
      getThorchainLpPositions({ thorAddress: 'thor1test' })
    ).rejects.toThrow(/non-array `pools`/)
  })

  it('throws when Midgard returns pools as an object', async () => {
    mockFetch({ pools: { foo: 'bar' } })
    await expect(
      getThorchainLpPositions({ thorAddress: 'thor1test' })
    ).rejects.toThrow(/non-array `pools`/)
  })

  it('returns empty when the pools key is absent (legacy Midgard empty)', async () => {
    mockFetch({})
    const result = await getThorchainLpPositions({
      thorAddress: 'thor1test',
    })
    expect(result).toEqual([])
  })

  it('throws when the response is not an object at all', async () => {
    mockFetch('hello')
    await expect(
      getThorchainLpPositions({ thorAddress: 'thor1test' })
    ).rejects.toThrow(/unexpected Midgard response shape/)
  })
})
