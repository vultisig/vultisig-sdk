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

    if (current instanceof HttpResponseError) {
      return current.status === 429 || (current.status >= 500 && current.status <= 599)
    }

    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && transientErrorCodes.has(code)) {
        return true
      }

      const status = (current as { status?: unknown }).status
      if (typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599))) {
        return true
      }
    }

    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : undefined
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
