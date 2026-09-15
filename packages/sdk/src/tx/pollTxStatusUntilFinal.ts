import type { Chain } from '@vultisig/core-chain/Chain'
import type { TxStatusResult } from '@vultisig/core-chain/tx/status/resolver'

export type PollTxStatusUntilFinalParams = {
  chain: Chain
  txHash: string
  getTxStatus: (params: { chain: Chain; txHash: string }) => Promise<TxStatusResult>
  initialResult?: TxStatusResult
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  isTerminal?: (result: TxStatusResult) => boolean
  shouldRetryError?: (error: unknown) => boolean
}

export type PollTxStatusUntilFinalResult = {
  result?: TxStatusResult
  attempts: number
  elapsedMs: number
  timedOut: boolean
  lastError?: unknown
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_INTERVAL_MS = 3_000

const defaultIsTerminal = (result: TxStatusResult): boolean =>
  result.status === 'success' || result.status === 'error' || result.status === 'expired'
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export async function pollTxStatusUntilFinal(
  params: PollTxStatusUntilFinalParams
): Promise<PollTxStatusUntilFinalResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS
  const now = params.now ?? Date.now
  const sleep = params.sleep ?? defaultSleep
  const isTerminal = params.isTerminal ?? defaultIsTerminal
  const shouldRetryError = params.shouldRetryError ?? (() => false)

  const startedAt = now()
  const deadline = startedAt + timeoutMs

  let attempts = 0
  let lastError: unknown
  let lastResult: TxStatusResult | undefined = params.initialResult

  if (lastResult && isTerminal(lastResult)) {
    return {
      result: lastResult,
      attempts,
      elapsedMs: now() - startedAt,
      timedOut: false,
    }
  }

  let shouldSleepBeforeNextAttempt = lastResult !== undefined

  while (now() <= deadline) {
    if (shouldSleepBeforeNextAttempt) {
      shouldSleepBeforeNextAttempt = false
      const remainingBeforeSleepMs = deadline - now()
      if (remainingBeforeSleepMs <= 0) break
      await sleep(Math.min(intervalMs, remainingBeforeSleepMs))
    }

    const remainingMs = deadline - now()
    if (remainingMs < 0) break

    let requestTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        params.getTxStatus({ chain: params.chain, txHash: params.txHash }),
        new Promise<TxStatusResult>((_resolve, reject) => {
          requestTimeout = setTimeout(() => reject(new Error('Timed out waiting for tx status response')), remainingMs)
        }),
      ]).finally(() => {
        if (requestTimeout) clearTimeout(requestTimeout)
      })

      attempts += 1
      lastResult = result
      lastError = undefined
      if (isTerminal(result)) {
        return {
          result,
          attempts,
          elapsedMs: now() - startedAt,
          timedOut: false,
        }
      }
    } catch (error) {
      attempts += 1
      lastError = error
      if (!shouldRetryError(error)) throw error
    }

    const remainingAfterAttemptMs = deadline - now()
    if (remainingAfterAttemptMs <= 0) break
    shouldSleepBeforeNextAttempt = true
  }

  return {
    result: lastResult,
    attempts,
    elapsedMs: now() - startedAt,
    timedOut: true,
    lastError,
  }
}
