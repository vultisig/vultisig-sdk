import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { describe, expect, it } from 'vitest'

import { isTransientSwapQuoteError } from './findSwapQuote'

const httpError = (status: number, message = 'Opaque provider response') =>
  new HttpResponseError({
    message,
    status,
    statusText: 'Provider response',
    url: 'https://example.test/quote',
    body: undefined,
  })

describe('isTransientSwapQuoteError', () => {
  it.each([new Error('request timed out'), 'failed to fetch', new Error('ECONNRESET'), httpError(429), httpError(503)])(
    'classifies transient raw quote failures',
    reason => {
      expect(isTransientSwapQuoteError(reason)).toBe(true)
    }
  )

  it.each([
    new Error('invalid asset'),
    httpError(400),
    'no swap route found',
    'amount below minimum: provider timed out',
    'quote below dust threshold after HTTP 503',
    httpError(503, 'no swap routes found while service unavailable'),
    'trading is halted: gateway timeout',
  ])('keeps structural and ordinary quote failures non-transient', reason => {
    expect(isTransientSwapQuoteError(reason)).toBe(false)
  })
})
