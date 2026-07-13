import { afterEach, describe, expect, it, vi } from 'vitest'

import { FetchTimeoutError } from '../../../../src/platforms/react-native/fetchWithTimeout'
import { joinRelaySession, waitForParties } from '../../../../src/platforms/react-native/mpc/relay'

const neverRespondingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
})

describe('React Native relay timeout and cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('bounds a wedged relay join request', async () => {
    vi.stubGlobal('fetch', neverRespondingFetch)

    await expect(
      joinRelaySession('http://127.0.0.1:1', 'session', 'local', { requestTimeoutMs: 10 })
    ).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('cancels an in-flight relay poll with the caller reason', async () => {
    vi.stubGlobal('fetch', neverRespondingFetch)
    const controller = new AbortController()
    const reason = new Error('sign screen closed')
    const promise = waitForParties('http://127.0.0.1:1', 'session', 2, 60_000, controller.signal, 10_000)

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })
})
