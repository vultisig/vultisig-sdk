import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryUrlMock } = vi.hoisted(() => ({
  queryUrlMock: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { MpcRelayMessage } from '.'
import {
  mpcRelaySendMaxAttempts,
  mpcRelayRetryDelaysMs,
  mpcRelaySendTimeoutMs,
  runMpcRelayProcessing,
  sendMpcRelayMessage,
  sendMpcRelayMessages,
} from './send'

const message: MpcRelayMessage = {
  session_id: 'session-id',
  from: 'sender',
  to: ['receiver'],
  body: 'encrypted-body',
  hash: 'message-hash',
  sequence_no: 7,
}

const httpError = (status: number) =>
  new HttpResponseError({
    message: `HTTP ${status}`,
    status,
    statusText: 'Error',
    url: 'https://relay.example/message/session-id',
    body: undefined,
  })

afterEach(() => {
  queryUrlMock.mockReset()
  vi.useRealTimers()
})

describe('sendMpcRelayMessage', () => {
  it('retries three transient failures before succeeding with an eight-second request deadline', async () => {
    vi.useFakeTimers()
    queryUrlMock
      .mockRejectedValueOnce(new TypeError('network request failed'))
      .mockRejectedValueOnce(httpError(502))
      .mockRejectedValueOnce(new Error('queryUrl: request timed out after 8000ms'))
      .mockResolvedValueOnce(undefined)

    const result = sendMpcRelayMessage({
      serverUrl: 'https://relay.example',
      sessionId: 'session-id',
      message,
      messageId: 'message-id',
    })

    await vi.runAllTimersAsync()
    await expect(result).resolves.toBeUndefined()
    expect(queryUrlMock).toHaveBeenCalledTimes(4)
    expect(queryUrlMock).toHaveBeenCalledWith(
      'https://relay.example/message/session-id',
      expect.objectContaining({ timeoutMs: mpcRelaySendTimeoutMs })
    )
  })

  it('does not retry an HTTP 4xx response', async () => {
    queryUrlMock.mockRejectedValue(httpError(400))

    await expect(
      sendMpcRelayMessage({
        serverUrl: 'https://relay.example',
        sessionId: 'session-id',
        message,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('retries Firefox NetworkError fetch failures', async () => {
    vi.useFakeTimers()
    queryUrlMock
      .mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'))
      .mockResolvedValueOnce(undefined)

    const result = sendMpcRelayMessage({
      serverUrl: 'https://relay.example',
      sessionId: 'session-id',
      message,
    })

    await vi.runAllTimersAsync()
    await expect(result).resolves.toBeUndefined()
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an unknown deterministic failure', async () => {
    const failure = new Error('invalid relay payload')
    queryUrlMock.mockRejectedValue(failure)

    await expect(
      sendMpcRelayMessage({
        serverUrl: 'https://relay.example',
        sessionId: 'session-id',
        message,
      })
    ).rejects.toBe(failure)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('throws the transient error after the bounded attempt count without a final sleep', async () => {
    vi.useFakeTimers()
    const failure = httpError(503)
    queryUrlMock.mockRejectedValue(failure)
    const startedAt = Date.now()

    const result = sendMpcRelayMessage({
      serverUrl: 'https://relay.example',
      sessionId: 'session-id',
      message,
    })
    const assertion = expect(result).rejects.toBe(failure)

    await vi.runAllTimersAsync()
    await assertion
    expect(queryUrlMock).toHaveBeenCalledTimes(mpcRelaySendMaxAttempts)
    expect(Date.now() - startedAt).toBe(mpcRelayRetryDelaysMs.reduce((total, delay) => total + delay, 0))
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('sendMpcRelayMessages', () => {
  it('waits for every receiver delivery and assigns consecutive sequence numbers', async () => {
    const pending = Array.from({ length: 3 }, () => {
      let resolve!: () => void
      const promise = new Promise<void>(resolvePromise => {
        resolve = resolvePromise
      })
      return { promise, resolve }
    })
    pending.forEach(({ promise }) => queryUrlMock.mockReturnValueOnce(promise))

    let settled = false
    const result = sendMpcRelayMessages({
      serverUrl: 'https://relay.example',
      sessionId: 'session-id',
      messageId: 'message-id',
      receivers: ['one', 'two', 'three'],
      sequenceNo: 11,
      message: {
        session_id: 'session-id',
        from: 'sender',
        body: 'encrypted-body',
        hash: 'message-hash',
      },
    }).then(value => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    pending[0].resolve()
    pending[1].resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    pending[2].resolve()

    await expect(result).resolves.toBe(14)
    expect(queryUrlMock.mock.calls.map(([, options]) => options.body)).toEqual([
      expect.objectContaining({ to: ['one'], sequence_no: 11 }),
      expect.objectContaining({ to: ['two'], sequence_no: 12 }),
      expect.objectContaining({ to: ['three'], sequence_no: 13 }),
    ])
  })

  it('cancels and settles sibling deliveries before surfacing a receiver 4xx', async () => {
    const clientError = httpError(400)
    let siblingAborted = false
    queryUrlMock.mockImplementation((_, options) => {
      if (options.body.to[0] === 'bad') {
        return Promise.reject(clientError)
      }

      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          siblingAborted = true
          reject(options.signal.reason)
        })
      })
    })

    await expect(
      sendMpcRelayMessages({
        serverUrl: 'https://relay.example',
        sessionId: 'session-id',
        receivers: ['bad', 'slow'],
        sequenceNo: 1,
        message: {
          session_id: 'session-id',
          from: 'sender',
          body: 'encrypted-body',
          hash: 'message-hash',
        },
      })
    ).rejects.toBe(clientError)
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    expect(siblingAborted).toBe(true)
  })
})

describe('runMpcRelayProcessing', () => {
  it('waits for inbound processing to stop before surfacing an outbound failure', async () => {
    const outboundFailure = new Error('relay send failed')
    let inboundSettled = false

    const result = runMpcRelayProcessing({
      processOutbound: async () => {
        throw outboundFailure
      },
      processInbound: signal =>
        new Promise<boolean>(resolve => {
          signal.addEventListener('abort', () => {
            inboundSettled = true
            resolve(false)
          })
        }),
    })

    await expect(result).rejects.toBe(outboundFailure)
    expect(inboundSettled).toBe(true)
  })

  it('returns the inbound result when both loops settle normally', async () => {
    await expect(
      runMpcRelayProcessing({
        processOutbound: async () => undefined,
        processInbound: async () => true,
      })
    ).resolves.toBe(true)
  })
})
