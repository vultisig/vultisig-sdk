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

  it('re-exports the shared chains namespace from the browser entrypoint', async () => {
    const browser = await import('../../../../src/platforms/browser/index')

    expect(browser.chains).toBeDefined()
    expect(typeof browser.chains.cosmos.buildCosmosStakingTx).toBe('function')
    expect(typeof browser.chains.evm.buildEvmSendTx).toBe('function')
  })
})
