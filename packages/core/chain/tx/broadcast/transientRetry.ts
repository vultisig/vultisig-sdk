import { BroadcastTxError } from '@cosmjs/stargate'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'

/**
 * A transaction was included on-chain but its execution genuinely failed
 * (e.g. Cosmos DeliverTx code !== 0 — a wasm revert, out-of-gas, a
 * THORChain/Maya deposit-handler rejection). This is a terminal, non-transient
 * outcome even though the chain-controlled error text can read exactly like
 * a transient one (a cosmwasm revert's rawLog routinely says "aborted"; a
 * contract can literally say "timed out" or "connection reset" as text).
 * Retrying would just re-send the same bytes, get "tx already exists in
 * cache" back, and have that swallowed as success — reopening the false-
 * success bug the throw exists to close. Resolvers that assert on-chain
 * execution success throw this instead of a bare Error so
 * `isTransientBroadcastError` can short-circuit before the message-regex
 * test ever runs.
 */
export class DeliverTxFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliverTxFailedError'
  }
}

export const broadcastRetryMaxAttempts = 3
const broadcastRetryBaseDelayMs = 250

const transientErrorCodes = new Set([
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

// gRPC statuses (Sui, since it retired JSON-RPC). `@protobuf-ts` surfaces the
// grpc-status trailer as `RpcError.code`, holding the status NAME — so these land
// in the same `code` slot as the errno strings above.
//
// Deliberately only the three the gRPC project itself calls safe to retry. Under
// JSON-RPC a busy or restarting node surfaced as an HTTP 5xx and was retried by the
// status branch below; without this set that coverage silently disappears, because a
// grpc-web response is HTTP 200 with the real status in the trailer.
//
// Excluded on purpose: INVALID_ARGUMENT / NOT_FOUND / FAILED_PRECONDITION are verdicts
// about the request itself, and ABORTED / INTERNAL are ambiguous enough that retrying
// could re-send bytes the chain already rejected.
const transientGrpcStatuses = new Set(['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED'])

// grpc-web percent-encodes the grpc-message trailer, so a server-produced message
// arrives as `connection%20reset` and none of the space-bearing patterns below can
// match it. Decode before testing (falling back to the raw text on a malformed escape)
// so gRPC errors are classified on the same footing as every other transport's.
const decodeTransportMessage = (message: string): string => {
  if (!message.includes('%')) return message
  try {
    return decodeURIComponent(message)
  } catch {
    return message
  }
}

const transientMessagePatterns = [
  /\bfetch failed\b/i,
  /\bfailed to fetch\b/i,
  /\bnetwork error\b/i,
  /\bnetwork request failed\b/i,
  /\brequest timed out\b/i,
  /\btimed out\b/i,
  /\babort(?:ed)?\b/i,
  /\bsocket hang up\b/i,
  /\bconnection (?:reset|refused|closed)\b/i,
  /\bHTTP (?:429|5\d\d)\b/i,
  /\btoo many requests\b/i,
  /\bbad gateway\b/i,
  /\bservice unavailable\b/i,
  /\bgateway timeout\b/i,
]

const wait = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs))

const getCause = (error: unknown): unknown => {
  if (error && typeof error === 'object' && 'cause' in error) {
    return (error as { cause?: unknown }).cause
  }

  return undefined
}

export const isTransientBroadcastError = (error: unknown): boolean => {
  let current: unknown = error
  const seen = new Set<unknown>()

  while (current != null && !seen.has(current)) {
    seen.add(current)

    if (current instanceof DeliverTxFailedError) {
      return false
    }

    // cosmjs's StargateClient.broadcastTxSync rejects with BroadcastTxError on
    // a non-zero CheckTx code — the tx was rejected by the node before it ever
    // reached the mempool. Its message is chain-controlled text (`log`), which
    // can read exactly like a transient network failure (ante-handler/wasm
    // errors routinely say "aborted", "timed out", "connection reset"). A
    // resend of the same bytes can't succeed differently — the node already
    // rejected it — so this is terminal, same as DeliverTxFailedError. Without
    // this check the message-regex test below would misclassify it as
    // transient, retry, and have the resend's "tx already exists in cache"
    // swallowed as a false success (see sdk#1383, the CheckTx sibling of the
    // DeliverTx-failure bug sdk#1316 already closed).
    if (current instanceof BroadcastTxError) {
      return false
    }

    if (current instanceof HttpResponseError) {
      return current.status === 429 || (current.status >= 500 && current.status <= 599)
    }

    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && (transientErrorCodes.has(code) || transientGrpcStatuses.has(code))) {
        return true
      }

      const status = (current as { status?: unknown }).status
      if (typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599))) {
        return true
      }
    }

    const rawMessage = current instanceof Error ? current.message : typeof current === 'string' ? current : undefined
    const message = rawMessage === undefined ? undefined : decodeTransportMessage(rawMessage)
    if (message && transientMessagePatterns.some(pattern => pattern.test(message))) {
      return true
    }

    current = getCause(current)
  }

  return false
}

export const withTransientBroadcastRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown

  for (let attempt = 1; attempt <= broadcastRetryMaxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt === broadcastRetryMaxAttempts || !isTransientBroadcastError(error)) {
        throw error
      }

      await wait(broadcastRetryBaseDelayMs * attempt)
    }
  }

  throw lastError
}
