import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryUrlMock } = vi.hoisted(() => ({
  queryUrlMock: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { getMpcRelayMessages } from './get'

afterEach(() => {
  queryUrlMock.mockReset()
  vi.useRealTimers()
})

describe('getMpcRelayMessages cancellation', () => {
  it('aborts an in-flight relay request when sibling outbound processing fails', async () => {
    const controller = new AbortController()
    const outboundFailure = new Error('relay send failed')
    queryUrlMock.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject((options.signal as AbortSignal).reason))
        })
    )

    const result = getMpcRelayMessages({
      serverUrl: 'https://relay.example',
      localPartyId: 'local',
      sessionId: 'session-id',
      signal: controller.signal,
    })
    controller.abort(outboundFailure)

    await expect(result).rejects.toBe(outboundFailure)
  })

  it('keeps the relay request bounded when a sibling cancellation signal is supplied', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    queryUrlMock.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject((options.signal as AbortSignal).reason))
        })
    )

    const result = getMpcRelayMessages({
      serverUrl: 'https://relay.example',
      localPartyId: 'local',
      sessionId: 'session-id',
      signal: controller.signal,
    })
    const assertion = expect(result).rejects.toThrow(/MPC relay request timed out after 20000ms/i)

    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })
})
