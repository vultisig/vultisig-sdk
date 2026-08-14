export const DEFAULT_RN_FETCH_TIMEOUT_MS = 30_000

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

const assertTimeout = (timeoutMs: number): void => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive finite number, got ${timeoutMs}`)
  }
}

const signalReason = (signal: AbortSignal): unknown =>
  (signal as AbortSignal & { reason?: unknown }).reason ?? new Error('Request aborted')

export const throwIfSignalAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signalReason(signal)
  }
}

export async function withFetchTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  assertTimeout(timeoutMs)

  const callerSignal = init.signal ?? undefined
  throwIfSignalAborted(callerSignal)

  const controller = new AbortController()
  let abortOperation: (reason: unknown) => void = () => {}
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortOperation = reason => {
      controller.abort()
      reject(reason)
    }
  })
  const abortFromCaller = () => abortOperation(callerSignal ? signalReason(callerSignal) : new Error('Request aborted'))
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => abortOperation(new FetchTimeoutError(timeoutMs)), timeoutMs)

  try {
    const operation = fetch(input, { ...init, signal: controller.signal }).then(consume)
    return await Promise.race([operation, abortPromise])
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export const delayWithSignal = (ms: number, signal?: AbortSignal): Promise<void> => {
  try {
    throwIfSignalAborted(signal)
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal ? signalReason(signal) : new Error('Delay aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
