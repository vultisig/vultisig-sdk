import { describe, expect, it } from 'vitest'

import {
  getTonActionFailure,
  getTonComputeFailure,
  getTonTxFailure,
  parseTonBroadcastRejection,
  TonBroadcastRejectedError,
} from './failure'

describe('getTonComputeFailure', () => {
  it('treats 0, 1 and an absent code as success', () => {
    expect(getTonComputeFailure(undefined)).toBeUndefined()
    expect(getTonComputeFailure(0)).toBeUndefined()
    expect(getTonComputeFailure(1)).toBeUndefined()
  })

  it.each([
    [33, 'seqno-mismatch'],
    [133, 'seqno-mismatch'],
    [34, 'wallet-id-mismatch'],
    [134, 'wallet-id-mismatch'],
    [35, 'invalid-signature'],
    [135, 'invalid-signature'],
    [36, 'expired'],
    [136, 'expired'],
    [13, 'out-of-gas'],
    [-14, 'out-of-gas'],
    [705, 'jetton-unauthorized'],
    [706, 'not-enough-jettons'],
    [707, 'jetton-unauthorized'],
    [709, 'jetton-gas-underfunded'],
  ] as const)('maps exit code %i to %s', (exitCode, reason) => {
    expect(getTonComputeFailure(exitCode)).toMatchObject({ reason, phase: 'compute', exitCode })
  })

  it('tells the user to check the device clock for an expired transaction', () => {
    expect(getTonComputeFailure(136)?.message).toMatch(/date and time/)
  })

  it('tells the user another transaction went first for a seqno mismatch', () => {
    expect(getTonComputeFailure(133)?.message).toMatch(/processed first/)
  })

  it('reports an unknown code by number', () => {
    expect(getTonComputeFailure(137)).toEqual({
      reason: 'contract-rejected',
      phase: 'compute',
      exitCode: 137,
      message: 'The contract rejected the transaction (exit code 137).',
    })
  })
})

describe('getTonActionFailure', () => {
  it('reads action-phase 36 as an invalid destination, not as the wallet expiry code', () => {
    expect(getTonActionFailure({ success: false, result_code: 36 })).toMatchObject({
      reason: 'invalid-destination',
      phase: 'action',
      exitCode: 36,
    })
  })

  it.each([37, 40])('reads result code %i as insufficient funds', resultCode => {
    expect(getTonActionFailure({ result_code: resultCode })).toMatchObject({ reason: 'insufficient-funds' })
    expect(getTonActionFailure({ result_code: resultCode })?.message).toMatch(/0\.05 TON/)
  })

  it('reads no_funds without a result code as insufficient funds', () => {
    expect(getTonActionFailure({ success: false, no_funds: true, result_code: 0 })).toMatchObject({
      reason: 'insufficient-funds',
    })
  })

  it('reports a skipped or unsuccessful action without a code as a generic no-op', () => {
    expect(getTonActionFailure({ success: true, result_code: 0, skipped_actions: 1 })).toMatchObject({
      reason: 'action-failed',
    })
    expect(getTonActionFailure({ success: false })).toMatchObject({ reason: 'action-failed' })
  })

  it('is silent for a healthy action phase', () => {
    expect(getTonActionFailure({ success: true, no_funds: false, result_code: 0, skipped_actions: 0 })).toBeUndefined()
    expect(getTonActionFailure(undefined)).toBeUndefined()
  })
})

describe('getTonTxFailure', () => {
  it('prefers the compute phase, then the action phase, then the aborted flag', () => {
    expect(
      getTonTxFailure({ aborted: true, compute_ph: { exit_code: 133 }, action: { result_code: 37 } })
    ).toMatchObject({ reason: 'seqno-mismatch' })
    expect(
      getTonTxFailure({ aborted: false, compute_ph: { exit_code: 0 }, action: { result_code: 37 } })
    ).toMatchObject({
      reason: 'insufficient-funds',
    })
    expect(getTonTxFailure({ aborted: true })).toMatchObject({ reason: 'aborted', phase: 'compute' })
  })

  it('returns nothing for a transaction that cleared both phases', () => {
    expect(getTonTxFailure({ aborted: false, compute_ph: { exit_code: 0 }, action: { success: true } })).toBeUndefined()
  })
})

describe('parseTonBroadcastRejection', () => {
  const toncenterRejection =
    'LITE_SERVER_UNKNOWN: cannot apply external message to current state : External message was not accepted\nCannot run message on account: inbound external message rejected by transaction 4C6FE61A4B7925532DEE47DEED8367FB9E918D4B32A9B9EC270BEF9D9C65CA13:\nexitcode=133, steps=49, gas_used=0\nVM Log (truncated):\n...execute THROWIFNOT 133\ndefault exception handler, terminating vm with exit code 133\n'

  it('reads the exit code out of a real toncenter rejection', () => {
    expect(parseTonBroadcastRejection(new Error(toncenterRejection))).toMatchObject({
      reason: 'seqno-mismatch',
      phase: 'compute',
      exitCode: 133,
    })
    expect(
      parseTonBroadcastRejection({ message: 'toncenter sendBocReturnHash failed: … exitcode=36, steps=13' })
    ).toMatchObject({ reason: 'expired', exitCode: 36 })
  })

  it('ignores transport errors and rejections without an exit code', () => {
    expect(parseTonBroadcastRejection(new Error('Failed to unpack Message'))).toBeUndefined()
    expect(parseTonBroadcastRejection(new Error('fetch failed'))).toBeUndefined()
    expect(parseTonBroadcastRejection(undefined)).toBeUndefined()
  })
})

describe('TonBroadcastRejectedError', () => {
  it('carries the human-readable message and keeps the original cause', () => {
    const cause = new Error('exitcode=136')
    const error = new TonBroadcastRejectedError(getTonComputeFailure(136)!, cause)

    expect(error.name).toBe('TonBroadcastRejectedError')
    expect(error.message).toMatch(/date and time/)
    expect(error.failure.reason).toBe('expired')
    expect(error.cause).toBe(cause)
  })
})
