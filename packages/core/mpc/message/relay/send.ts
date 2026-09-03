import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

import { MpcRelayMessage } from '.'
import { withMpcRelayRequestSignal } from './get'

type SendMpcRelayMessageInput = {
  serverUrl: string
  sessionId: string
  messageId?: string
  message: MpcRelayMessage
  signal?: AbortSignal
}

type SendMpcRelayMessagesInput = Omit<SendMpcRelayMessageInput, 'message'> & {
  message: Omit<MpcRelayMessage, 'to' | 'sequence_no'>
  receivers: string[]
  sequenceNo: number
}

type RunMpcRelayProcessingInput<T> = {
  processOutbound: (signal: AbortSignal) => Promise<unknown>
  processInbound: (signal: AbortSignal) => Promise<T>
}

export const mpcRelaySendTimeoutMs = 8_000
export const mpcRelayRetryDelaysMs = [1_000, 2_000, 4_000, 8_000] as const
export const mpcRelaySendMaxAttempts = mpcRelayRetryDelaysMs.length + 1

const retryableNetworkErrorCodes = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

const retryableNetworkErrorPatterns = [
  /\bfetch failed\b/i,
  /\bfailed to fetch\b/i,
  /\bload failed\b/i,
  /\bnetwork ?error\b/i,
  /\bnetwork request failed\b/i,
  /\brequest timed out\b/i,
  /\btimed out\b/i,
  /\bsocket hang up\b/i,
  /\bconnection (?:reset|refused|closed)\b/i,
]

const isRetryableRelaySendError = (error: unknown) => {
  if (error instanceof HttpResponseError) {
    return error.status >= 500 && error.status <= 599
  }

  if (error && typeof error === 'object') {
    const { code, name } = error as { code?: unknown; name?: unknown }
    if (typeof code === 'string' && retryableNetworkErrorCodes.has(code)) {
      return true
    }
    if (name === 'AbortError' || name === 'TimeoutError') {
      return true
    }
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  return message !== undefined && retryableNetworkErrorPatterns.some(pattern => pattern.test(message))
}

const waitForMpcRelayRetry = (duration: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, duration)
    if (!signal) {
      return
    }

    const abortSignal = signal
    function abort() {
      clearTimeout(timeoutId)
      reject(abortSignal.reason)
    }
    abortSignal.addEventListener('abort', abort, { once: true })
  })

export const sendMpcRelayMessage = async ({
  serverUrl,
  sessionId,
  message,
  messageId,
  signal,
}: SendMpcRelayMessageInput) => {
  const url = `${serverUrl}/message/${sessionId}`

  for (let attempt = 0; attempt < mpcRelaySendMaxAttempts; attempt++) {
    try {
      if (signal?.aborted) {
        throw signal.reason
      }

      const request = (effectiveSignal?: AbortSignal) =>
        queryUrl(url, {
          headers: withoutUndefinedFields({
            message_id: messageId,
          }),
          body: message,
          responseType: 'none',
          timeoutMs: mpcRelaySendTimeoutMs,
          signal: effectiveSignal,
        })

      return await (signal ? withMpcRelayRequestSignal(signal, url, request, mpcRelaySendTimeoutMs) : request())
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }

      const isFinalAttempt = attempt === mpcRelaySendMaxAttempts - 1
      if (isFinalAttempt || !isRetryableRelaySendError(error)) {
        throw error
      }

      await waitForMpcRelayRetry(mpcRelayRetryDelaysMs[attempt], signal)
    }
  }
}

export const sendMpcRelayMessages = async ({
  receivers,
  sequenceNo,
  message,
  ...input
}: SendMpcRelayMessagesInput): Promise<number> => {
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) {
    abort()
  } else {
    input.signal?.addEventListener('abort', abort, { once: true })
  }

  const sends = receivers.map((receiver, index) =>
    sendMpcRelayMessage({
      ...input,
      signal: controller.signal,
      message: {
        ...message,
        to: [receiver],
        sequence_no: sequenceNo + index,
      },
    })
  )

  try {
    await Promise.all(sends)
    return sequenceNo + receivers.length
  } catch (error) {
    controller.abort(error)
    await Promise.allSettled(sends)
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
  }
}

export const runMpcRelayProcessing = async <T>({
  processOutbound,
  processInbound,
}: RunMpcRelayProcessingInput<T>): Promise<T> => {
  const controller = new AbortController()
  const outbound = processOutbound(controller.signal)
  const inbound = processInbound(controller.signal)

  try {
    const [, inboundResult] = await Promise.all([outbound, inbound])
    return inboundResult
  } catch (error) {
    controller.abort()
    await Promise.allSettled([outbound, inbound])
    throw error
  } finally {
    controller.abort()
  }
}
