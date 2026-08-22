import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { kaminoConfig } from './config'
import { fetchKaminoPnl, fetchKaminoUserPositions, fetchKaminoVaultState } from './api'
import { KaminoServiceError } from './KaminoServiceError'

const httpError = (status: number, body: unknown) =>
  new HttpResponseError({ message: 'HTTP error', status, statusText: '', url: 'https://api.kamino.finance/x', body })

// A block body on purpose: `mockReset()` returns the mock, and a function
// returned from `beforeEach` is treated as a teardown callback — vitest would
// call `queryUrl()` bare after each test, minting an unhandled rejection under
// `mockRejectedValue`.
beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('kamino api error envelope', () => {
  it('converts the structured error body into a typed, branchable error', async () => {
    vi.mocked(queryUrl).mockRejectedValue(
      httpError(400, { statusCode: 400, message: 'kVault not found', error: 'Bad Request', code: 'KVAULT_NOT_FOUND' })
    )

    const failure = await fetchKaminoVaultState('HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E').catch(
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(KaminoServiceError)
    expect((failure as KaminoServiceError).reason).toEqual({
      api: { status: 400, code: 'KVAULT_NOT_FOUND', message: 'kVault not found' },
    })
    expect((failure as KaminoServiceError).isRetryable).toBe(false)
  })

  it('keeps the transport status: a retryable 503 can carry the same body shape as a permanent 400', async () => {
    vi.mocked(queryUrl).mockRejectedValue(
      httpError(503, { statusCode: 400, message: 'upstream unavailable', error: 'Service Unavailable' })
    )

    const failure = await fetchKaminoUserPositions('owner').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KaminoServiceError)
    expect((failure as KaminoServiceError).reason).toEqual({
      api: { status: 503, code: undefined, message: 'upstream unavailable' },
    })
    expect((failure as KaminoServiceError).isRetryable).toBe(true)
  })

  it('rethrows errors that do not carry the structured body', async () => {
    const bare = httpError(502, '<html>Bad Gateway</html>')
    vi.mocked(queryUrl).mockRejectedValue(bare)

    await expect(fetchKaminoPnl({ owner: 'o', vault: 'v' })).rejects.toBe(bare)
  })

  it('builds the documented paths', async () => {
    vi.mocked(queryUrl).mockResolvedValue([] as never)

    await fetchKaminoUserPositions('ownerPubkey')

    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toBe(
      `${kaminoConfig.apiBaseUrl}/kvaults/users/ownerPubkey/positions`
    )
  })

  it('encodes path parameters so a hostile value cannot change the endpoint', async () => {
    vi.mocked(queryUrl).mockResolvedValue([] as never)

    await fetchKaminoUserPositions('../vaults/x?y=#z')

    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toBe(
      `${kaminoConfig.apiBaseUrl}/kvaults/users/..%2Fvaults%2Fx%3Fy%3D%23z/positions`
    )
  })
})

describe('kamino api base url', () => {
  it('goes through the Vultisig proxy, not Kamino directly', () => {
    // Upstream 404s the CORS preflight and sets no allow-origin on the build
    // endpoints, so a browser cannot POST to it. Pointing this back at Kamino
    // would break deposits and withdrawals in every webview while every other
    // test here still passed, which is why the host is pinned.
    expect(kaminoConfig.apiBaseUrl).toBe('https://api.vultisig.com/kamino')
  })
})
