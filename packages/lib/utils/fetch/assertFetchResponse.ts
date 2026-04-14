import { extractErrorMsg } from '../error/extractErrorMsg'
import { asyncFallbackChain } from '../promise/asyncFallbackChain'
import { HttpResponseError } from './HttpResponseError'

/**
 * Asserts a fetch Response is OK. On non-2xx, throws `HttpResponseError`
 * carrying the numeric status, statusText, url, and parsed body so
 * callers can branch on `err.status` instead of string-matching `err.message`.
 *
 * The thrown error's `message` still includes the same human-readable
 * format as before (`HTTP <status> <statusText>: ...`) so callers that
 * only log `err.message` see no change.
 */
export const assertFetchResponse = async (response: Response) => {
  if (!response.ok) {
    const body = await asyncFallbackChain(
      async () => response.json(),
      async () => response.text(),
      async () =>
        `HTTP ${response.status} ${response.statusText || 'Error'}: Request failed for ${response.url}`
    )
    const msg = extractErrorMsg(body)

    throw new HttpResponseError({
      message: msg,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      body,
    })
  }
}
