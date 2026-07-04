// Cache-free auth-retry for the `agent sessions list`/`delete` commands
// (audit fix-07 finding a, command-side mirror of AgentSession.withAuthRetry).
//
// A token revoked between createAuthenticatedClient and the list/delete call
// must recover (re-auth + retry once) instead of surfacing a raw 401.
import { describe, expect, it, vi } from 'vitest'

import { withClientAuthRetry } from '../agent'

// Keep isAuthError (and everything else commands/agent.ts pulls from the agent
// barrel) real; stub only authenticateVault so no MPC/network runs.
vi.mock('../../agent', async importActual => {
  const actual = (await importActual()) as Record<string, unknown>
  return { ...actual, authenticateVault: vi.fn(async () => ({ token: 'reauth-tok', expiresAt: 1 })) }
})

import { authenticateVault } from '../../agent'

const authError = () => new Error('Request failed (401): unauthorized')

function makeClient() {
  return { setAuthToken: vi.fn() } as any
}
const vault = { publicKeys: { ecdsa: 'pk' } } as any

describe('withClientAuthRetry', () => {
  it('re-auths and retries once on a 401, returning the retry result', async () => {
    vi.mocked(authenticateVault).mockClear()
    const client = makeClient()
    let calls = 0
    const request = vi.fn(async () => {
      calls++
      if (calls === 1) throw authError()
      return 'ok'
    })

    await expect(withClientAuthRetry(client, vault, undefined, request)).resolves.toBe('ok')

    expect(request).toHaveBeenCalledTimes(2)
    expect(authenticateVault).toHaveBeenCalledTimes(1)
    expect(client.setAuthToken).toHaveBeenCalledWith('reauth-tok')
  })

  it('rethrows a non-auth error without re-authenticating', async () => {
    vi.mocked(authenticateVault).mockClear()
    const client = makeClient()
    const request = vi.fn(async () => {
      throw new Error('500 server error')
    })

    await expect(withClientAuthRetry(client, vault, undefined, request)).rejects.toThrow(/500/)
    expect(request).toHaveBeenCalledTimes(1)
    expect(authenticateVault).not.toHaveBeenCalled()
  })

  it('propagates a 401 that survives the single retry (bounded, not infinite)', async () => {
    vi.mocked(authenticateVault).mockClear()
    const client = makeClient()
    const request = vi.fn(async () => {
      throw authError()
    })

    await expect(withClientAuthRetry(client, vault, undefined, request)).rejects.toThrow(/401/)
    expect(request).toHaveBeenCalledTimes(2) // original + one retry
    expect(authenticateVault).toHaveBeenCalledTimes(1)
  })
})
