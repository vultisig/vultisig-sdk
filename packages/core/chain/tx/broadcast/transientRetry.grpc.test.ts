import { describe, expect, it } from 'vitest'

import { DeliverTxFailedError, isTransientBroadcastError } from './transientRetry'

// Sui retired JSON-RPC, so its broadcasts now fail through gRPC. `@protobuf-ts`
// surfaces the grpc-status/grpc-message trailer pair as an `RpcError` whose `code`
// is the status NAME and whose `message` is still PERCENT-ENCODED (grpc-web escapes
// the trailer). Both fixtures here are verbatim mainnet captures from
// `fullnode.mainnet.sui.io`.
const rpcError = (message: string, code: string) => Object.assign(new Error(message), { code })

describe('isTransientBroadcastError — gRPC transport', () => {
  it.each(['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED'])(
    'retries the %s grpc status (a busy/restarting node used to arrive as an HTTP 5xx)',
    status => {
      // A grpc-web response is HTTP 200 with the real status in the trailer, so the
      // existing 5xx branch never sees these.
      expect(isTransientBroadcastError(rpcError('node%20restarting', status))).toBe(true)
    }
  )

  it.each([
    ['INVALID_ARGUMENT', 'invalid%20signature:%20missing%20signature%20scheme%20flag'],
    ['NOT_FOUND', 'Transaction%2011111111111111111111111111111111%20not%20found'],
    ['FAILED_PRECONDITION', 'object%20version%20unavailable'],
  ])('does not retry the %s grpc status (a verdict about the request, not the connection)', (status, message) => {
    expect(isTransientBroadcastError(rpcError(message, status))).toBe(false)
  })

  it('decodes the percent-encoded grpc-message so genuinely transient text still matches', () => {
    // Without decoding, a space-bearing pattern (`connection reset`) can never match
    // the raw wire text and a retryable failure is misread as permanent.
    expect(isTransientBroadcastError(new Error('connection%20reset%20by%20peer'))).toBe(true)
    expect(isTransientBroadcastError(new Error('request%20timed%20out'))).toBe(true)
    // Red-on-revert anchor: the same text undecoded matches nothing.
    expect(/\bconnection (?:reset|refused|closed)\b/i.test('connection%20reset%20by%20peer')).toBe(false)
  })

  it('leaves a malformed percent-escape alone instead of throwing', () => {
    // decodeURIComponent throws on a stray '%'; classification must survive it.
    expect(() => isTransientBroadcastError(new Error('100% failure, no retry signal'))).not.toThrow()
    expect(isTransientBroadcastError(new Error('100% failure, no retry signal'))).toBe(false)
    // A stray '%' must not mask a real transient signal either.
    expect(isTransientBroadcastError(new Error('100% packet loss: socket hang up'))).toBe(true)
  })

  it('still refuses to retry an on-chain execution failure even under a transient-looking status', () => {
    // The DeliverTxFailedError marker short-circuits BEFORE any code/message test —
    // a Sui MoveAbort's chain-controlled text routinely contains "aborted".
    const aborted = Object.assign(new DeliverTxFailedError('Sui transaction failed on-chain: MoveAbort ... aborted'), {
      code: 'UNAVAILABLE',
    })
    expect(isTransientBroadcastError(aborted)).toBe(false)
  })
})
