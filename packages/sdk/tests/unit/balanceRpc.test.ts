import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson } from '../../src/tools/balance/rpc'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('balance rpc fetchJson', () => {
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
