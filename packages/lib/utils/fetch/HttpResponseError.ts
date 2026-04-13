/**
 * Typed error thrown by `assertFetchResponse` for non-2xx HTTP responses.
 *
 * Carries the numeric `status` so callers can branch cleanly on it
 * (`err.status === 404`) instead of regex-matching the message string. The
 * `statusText`, `url`, and parsed `body` fields are preserved for logging
 * and richer error reporting.
 *
 * The constructor still falls through to `Error.message` so existing
 * callers that only read `err.message` keep working unchanged.
 */
export class HttpResponseError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly body: unknown

  constructor(opts: {
    message: string
    status: number
    statusText: string
    url: string
    body: unknown
  }) {
    super(opts.message)
    this.name = 'HttpResponseError'
    this.status = opts.status
    this.statusText = opts.statusText
    this.url = opts.url
    this.body = opts.body
  }
}
