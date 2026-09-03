import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

import { MpcRelayMessage } from '.'

type GetMpcRelayMessagesInput = {
  serverUrl: string
  localPartyId: string
  sessionId: string
  messageId?: string
  signal?: AbortSignal
}

const mpcRelayRequestTimeoutMs = 20_000

export const withMpcRelayRequestSignal = async <T>(
  signal: AbortSignal,
  url: string,
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = mpcRelayRequestTimeoutMs
): Promise<T> => {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`MPC relay request timed out after ${timeoutMs}ms (${url})`)),
    timeoutMs
  )

  if (signal.aborted) {
    abort()
  } else {
    signal.addEventListener('abort', abort, { once: true })
  }

  try {
    return await request(controller.signal)
  } finally {
    clearTimeout(timeoutId)
    signal.removeEventListener('abort', abort)
  }
}

export const getMpcRelayMessages = async ({
  serverUrl,
  localPartyId,
  sessionId,
  messageId,
  signal,
}: GetMpcRelayMessagesInput) =>
  (() => {
    const url = `${serverUrl}/message/${sessionId}/${localPartyId}`
    const request = (effectiveSignal?: AbortSignal) =>
      queryUrl<MpcRelayMessage[]>(url, {
        headers: withoutUndefinedFields({
          message_id: messageId,
        }),
        responseType: 'json',
        signal: effectiveSignal,
      })

    return signal ? withMpcRelayRequestSignal(signal, url, request) : request()
  })()
