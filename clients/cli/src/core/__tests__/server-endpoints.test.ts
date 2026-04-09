import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseServerEndpointOverridesFromArgv, resolveServerEndpoints } from '../server-endpoints'

describe('resolveServerEndpoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined when nothing is overridden so SDK defaults stay authoritative', () => {
    expect(resolveServerEndpoints()).toBeUndefined()
  })

  it('derives both endpoints from a shared server url', () => {
    expect(resolveServerEndpoints({ serverUrl: 'http://127.0.0.1:8080/' })).toEqual({
      fastVault: 'http://127.0.0.1:8080/vault',
      messageRelay: 'http://127.0.0.1:8080/router',
    })
  })

  it('falls back to env vars using the same resolution order', () => {
    vi.stubEnv('VULTISIG_SERVER_URL', 'http://127.0.0.1:7000')

    expect(resolveServerEndpoints()).toEqual({
      fastVault: 'http://127.0.0.1:7000/vault',
      messageRelay: 'http://127.0.0.1:7000/router',
    })
  })
})

describe('parseServerEndpointOverridesFromArgv', () => {
  it('reads kebab-case CLI flags from argv', () => {
    expect(parseServerEndpointOverridesFromArgv(['--server-url', 'http://127.0.0.1:8080'])).toEqual({
      serverUrl: 'http://127.0.0.1:8080',
    })
  })

  it('reads equals-style CLI flags from argv', () => {
    expect(parseServerEndpointOverridesFromArgv(['--server-url=http://127.0.0.1:8080'])).toEqual({
      serverUrl: 'http://127.0.0.1:8080',
    })
  })
})
