import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'

/**
 * Base marker for a genuinely terminal broadcast outcome — the node (or the
 * chain, via inclusion) made a final decision about this exact payload, so
 * retrying would only resend identical bytes into an already-decided result.
 * Distinct from a network-transport failure, where the node never even got
 * to evaluate the tx. `isTransientBroadcastError` short-circuits on any
 * subclass before the message-regex test ever runs, so a terminal failure
 * whose chain-controlled text happens to read as transient ("aborted",
 * "timed out", "connection reset" are all real ante-handler/contract-revert
 * strings) can never get misclassified and retried.
 */
export abstract class TerminalBroadcastError extends Error {}

/**
 * A transaction was included on-chain but its execution genuinely failed
 * (e.g. Cosmos DeliverTx code !== 0 — a wasm revert, out-of-gas, a
 * THORChain/Maya deposit-handler rejection). Retrying would just re-send the
 * same bytes, get "tx already exists in cache" back, and have that swallowed
 * as success — reopening the false-success bug the throw exists to close.
 * Resolvers that assert on-chain execution success throw this instead of a
 * bare Error.
 */
export class DeliverTxFailedError extends TerminalBroadcastError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliverTxFailedError'
  }
}

/**
 * A node evaluated a specific broadcast payload (e.g. Cosmos CheckTx) and
 * rejected it outright — invalid sequence, insufficient funds, a doomed
 * contract call caught during ante-handler simulation. On a node with
 * `keep-invalid-txs-in-cache=true`, CometBFT caches a REJECTED tx's hash the
 * same as an accepted one, so a resend of the identical bytes can come back
 * "tx already exists in cache" purely from the rejection's own cache entry —
 * no peer broadcast required — and get swallowed as an idempotent success.
 * Resolvers that see a node-level rejection throw this instead of a bare
 * Error so the retry wrapper never resends into that trap.
 */
export class NodeRejectedBroadcastError extends TerminalBroadcastError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NodeRejectedBroadcastError'
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

    if (current instanceof TerminalBroadcastError) {
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
