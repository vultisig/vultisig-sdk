import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('configureRuntime — URL validation', () => {
  beforeEach(() => {
    // Reset the module-scope `state` between tests so the positive case
    // doesn't leak into later assertions.
    vi.resetModules()
  })

  it('rejects empty vultiServerUrl', async () => {
    const { configureRuntime } = await import('../../../../src/platforms/react-native/runtime')
    expect(() => configureRuntime({ vultiServerUrl: '' })).toThrow(/vultiServerUrl/)
  })

  it('rejects empty relayUrl', async () => {
    const { configureRuntime } = await import('../../../../src/platforms/react-native/runtime')
    expect(() => configureRuntime({ relayUrl: '' })).toThrow(/relayUrl/)
  })

  it('rejects a non-http(s) scheme', async () => {
    const { configureRuntime } = await import('../../../../src/platforms/react-native/runtime')
    expect(() => configureRuntime({ vultiServerUrl: 'javascript:alert(1)' })).toThrow(
      /http\(s\)|must be http/
    )
    expect(() => configureRuntime({ vultiServerUrl: 'file:///tmp/evil' })).toThrow(
      /http\(s\)|must be http/
    )
  })

  it('rejects a string that is not a URL at all', async () => {
    const { configureRuntime } = await import('../../../../src/platforms/react-native/runtime')
    expect(() => configureRuntime({ vultiServerUrl: 'not a url' })).toThrow(/not a valid URL/)
    // Relative path — no scheme, no host — must also fail.
    expect(() => configureRuntime({ relayUrl: '/sign' })).toThrow(/not a valid URL/)
  })

  it('accepts well-formed http and https URLs', async () => {
    const { configureRuntime, getConfiguredVultiServerUrl, getConfiguredRelayUrl } = await import(
      '../../../../src/platforms/react-native/runtime'
    )
    expect(() =>
      configureRuntime({
        vultiServerUrl: 'https://api.vultisig.com/vault',
        relayUrl: 'http://localhost:8080',
      })
    ).not.toThrow()
    expect(getConfiguredVultiServerUrl()).toBe('https://api.vultisig.com/vault')
    expect(getConfiguredRelayUrl()).toBe('http://localhost:8080')
  })

  it('allows omitting both fields (undefined passes through)', async () => {
    const { configureRuntime } = await import('../../../../src/platforms/react-native/runtime')
    expect(() => configureRuntime({})).not.toThrow()
  })
})
