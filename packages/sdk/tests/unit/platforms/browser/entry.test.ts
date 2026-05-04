import { afterEach, describe, expect, it, vi } from 'vitest'

describe('browser preamble runtime globals', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('installs globalThis.Buffer before browser crypto shims need it', async () => {
    vi.stubGlobal('Buffer', undefined)
    vi.resetModules()

    await import('../../../../src/platforms/browser/preamble')

    expect((globalThis as { Buffer?: unknown }).Buffer).toBeDefined()
  })
})
