import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const defaultBaseUrl = 'https://api.vultisig.com/jup'

// Re-import a fresh module per test so the module-level `jupiterConfig` state
// doesn't leak between cases.
const loadConfig = async () => {
  vi.resetModules()
  return import('./config')
}

describe('jupiter config baseUrl normalization', () => {
  beforeEach(() => {
    delete process.env.JUPITER_BASE_URL
    delete process.env.VULTISIG_JUPITER_BASE_URL
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.JUPITER_BASE_URL
    delete process.env.VULTISIG_JUPITER_BASE_URL
  })

  it('returns the default base URL when nothing is overridden', async () => {
    const { getJupiterConfig } = await loadConfig()
    expect(getJupiterConfig().baseUrl).toBe(defaultBaseUrl)
  })

  it('ignores a blank/whitespace configureJupiter override and keeps the default', async () => {
    const { configureJupiter, getJupiterConfig } = await loadConfig()
    configureJupiter({ baseUrl: '   ' })
    expect(getJupiterConfig().baseUrl).toBe(defaultBaseUrl)
  })

  it('trims and strips trailing slashes from a configureJupiter override', async () => {
    const { configureJupiter, getJupiterConfig } = await loadConfig()
    configureJupiter({ baseUrl: '  https://proxy.example/jup//  ' })
    expect(getJupiterConfig().baseUrl).toBe('https://proxy.example/jup')
  })

  it('ignores a blank JUPITER_BASE_URL env var and falls back', async () => {
    const { configureJupiter, getJupiterConfig } = await loadConfig()
    configureJupiter({ baseUrl: 'https://configured.example/jup' })
    process.env.JUPITER_BASE_URL = '   '
    expect(getJupiterConfig().baseUrl).toBe('https://configured.example/jup')
  })

  it('uses and normalizes a non-blank env override', async () => {
    const { getJupiterConfig } = await loadConfig()
    process.env.JUPITER_BASE_URL = 'https://env.example/jup/'
    expect(getJupiterConfig().baseUrl).toBe('https://env.example/jup')
  })
})
