import { assertFetchResponse } from '../fetch/assertFetchResponse'
import { withoutUndefinedFields } from '../record/withoutUndefinedFields'

type ResponseType = 'json' | 'text' | 'none'

type QueryUrlOptions = {
  responseType?: ResponseType
  body?: any
  /**
   * Deadline in ms for the DEFAULT-timeout path (only applied when the caller
   * does not pass its own `signal`). Defaults to DEFAULT_QUERY_TIMEOUT_MS.
   */
  timeoutMs?: number
} & Pick<RequestInit, 'method' | 'headers' | 'signal'>

// Default deadline for any queryUrl call that doesn't bring its own AbortSignal.
// An unbounded fetch against a hung/slow upstream wedges the caller forever: the
// `/coingeicko` price proxy stalling is what made fiatToAmount -> execute_send
// hang and perma-loaded the agent send card's "Network fee" row until the app's
// own 60s build-timeout fired. 20s matches the SDK's other HTTP timeouts
// (balance/swap rails) — comfortably above a healthy query, still bounding a hang.
const DEFAULT_QUERY_TIMEOUT_MS = 20_000

const processBody = (body: any) => {
  if (body === undefined) {
    return undefined
  }

  if (typeof body === 'string') {
    return body
  }
  return JSON.stringify(body)
}

export function queryUrl(url: string | URL, options: QueryUrlOptions & { responseType: 'none' }): Promise<void>

export function queryUrl<T extends string = string>(
  url: string | URL,
  options: QueryUrlOptions & { responseType: 'text' }
): Promise<T>

export function queryUrl<T>(url: string | URL, options?: QueryUrlOptions & { responseType?: 'json' }): Promise<T>

export async function queryUrl<T>(url: string | URL, options: QueryUrlOptions = {}): Promise<T | string | void> {
  const { responseType = 'json', body, headers, method, signal, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = options

  // Hermes-compatible default deadline: `AbortSignal.timeout()` isn't available
  // on older RN/Hermes runtimes (see sdk tools/gas/utxoFeeRate.ts), so when the
  // caller doesn't supply its own signal, bound the fetch with
  // AbortController + setTimeout. Callers that pass `signal` own cancellation
  // and opt out of the default deadline.
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let effectiveSignal = signal
  if (!effectiveSignal) {
    const controller = new AbortController()
    timeoutId = setTimeout(
      () => controller.abort(new Error(`queryUrl: request timed out after ${timeoutMs}ms (${String(url)})`)),
      timeoutMs
    )
    effectiveSignal = controller.signal
  }

  try {
    const response = await fetch(
      url,
      withoutUndefinedFields({
        method: method ?? (body ? 'POST' : 'GET'),
        headers: withoutUndefinedFields({
          ...headers,
          'Content-Type': body ? 'application/json' : undefined,
        }),
        body: processBody(body),
        signal: effectiveSignal,
      })
    )

    await assertFetchResponse(response)

    if (responseType !== 'none') {
      return response[responseType]()
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
