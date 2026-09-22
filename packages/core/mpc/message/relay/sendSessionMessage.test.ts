import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryUrlMock } = vi.hoisted(() => ({ queryUrlMock: vi.fn() }))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: queryUrlMock }))

import { getMessageHash } from '../../getMessageHash'
import { fromMpcServerMessage } from '../server'
import { sendMpcRelaySessionMessage } from './send'

const body = Uint8Array.from([0, 1, 127, 128, 255])
const hexEncryptionKey = '01'.repeat(32)
const input = {
  serverUrl: 'https://relay.example',
  sessionId: 'session-id',
  localPartyId: 'sender',
  hexEncryptionKey,
  messageId: 'p-ecdsa',
  message: { body, receivers: ['one', 'two'] },
  sequenceNo: 11,
}

afterEach(() => queryUrlMock.mockReset())

describe('sendMpcRelaySessionMessage', () => {
  it('preserves the encrypted envelope, hash, namespace and per-receiver sequences', async () => {
    queryUrlMock.mockResolvedValue(undefined)
    await expect(sendMpcRelaySessionMessage({ ...input, signal: new AbortController().signal })).resolves.toBe(13)
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    for (const [index, [url, options]] of queryUrlMock.mock.calls.entries()) {
      expect(url).toBe('https://relay.example/message/session-id')
      expect(options.headers).toEqual({ message_id: 'p-ecdsa' })
      expect(options.body).toMatchObject({
        session_id: 'session-id',
        from: 'sender',
        to: [input.message.receivers[index]],
        sequence_no: 11 + index,
        hash: getMessageHash(base64Encode(body)),
      })
      expect(new Uint8Array(fromMpcServerMessage(options.body.body, hexEncryptionKey))).toEqual(body)
    }
    expect(queryUrlMock.mock.calls[0][1].body.body).toBe(queryUrlMock.mock.calls[1][1].body.body)
  })

  it('does not advance the sequence until every delivery settles', async () => {
    let completeSlow!: () => void
    queryUrlMock.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          completeSlow = resolve
        })
    )
    let settled = false
    const result = sendMpcRelaySessionMessage({ ...input, signal: new AbortController().signal }).then(sequence => {
      settled = true
      return sequence
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    completeSlow()
    await expect(result).resolves.toBe(13)
  })

  it('preserves terminal delivery failures and settles the cancelled sibling', async () => {
    const failure = new HttpResponseError({
      message: 'HTTP 400',
      status: 400,
      statusText: 'Bad Request',
      url: 'https://relay.example/message/session-id',
      body: undefined,
    })
    let siblingSettled = false
    queryUrlMock.mockRejectedValueOnce(failure).mockImplementationOnce(
      (_, options) =>
        new Promise<void>((_, reject) => {
          options.signal.addEventListener('abort', () => {
            siblingSettled = true
            reject(options.signal.reason)
          })
        })
    )
    await expect(sendMpcRelaySessionMessage({ ...input, signal: new AbortController().signal })).rejects.toBe(failure)
    expect(siblingSettled).toBe(true)
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
  })
})
