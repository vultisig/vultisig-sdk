import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'

/**
 * Why a TON transaction did not move funds, in terms a user can act on. The
 * wallet contract's own checks (`seqno-mismatch`, `expired`, `invalid-signature`,
 * `wallet-id-mismatch`) fire in the compute phase of the sender's wallet; the
 * money-related ones fire when the wallet tries to emit the transfer (action
 * phase) or in the jetton wallet's compute phase.
 */
export const tonTxFailureReasons = [
  'seqno-mismatch',
  'expired',
  'invalid-signature',
  'wallet-id-mismatch',
  'insufficient-funds',
  'out-of-gas',
  'invalid-destination',
  'not-enough-jettons',
  'jetton-unauthorized',
  'action-failed',
  'action-partially-failed',
  'aborted',
  'contract-rejected',
] as const

export type TonTxFailureReason = (typeof tonTxFailureReasons)[number]

/** Which phase of the TON transaction produced the code: TVM execution or emitting the outgoing messages. */
export type TonTxPhase = 'compute' | 'action'

export type TonTxFailure = {
  reason: TonTxFailureReason
  phase: TonTxPhase
  exitCode?: number
  /** Plain-language explanation with the remedy, in English. */
  message: string
}

/**
 * Compute-phase exit codes. The sender's wallet contract throws the first block
 * from `recv_external`: wallet v3/v4 use 33–36, W5 uses 133–136 for the same
 * checks. 13 / -14 are the TVM's out-of-gas codes. 705 and 706 come from the
 * standard jetton wallet (TEP-74) and mean the same thing on a transfer and on
 * a burn; its 707 and 709 are deliberately absent because the reference
 * contract reuses each for two unrelated checks (707: unauthorized incoming
 * transfer, or too little TON on a burn; 709: too little TON on a transfer, or
 * an unexpected bounced op), and the code alone cannot tell which. Everything
 * else is a contract-specific revert we can only report by number.
 */
const computeExitCodeReasons: Record<number, TonTxFailureReason> = {
  33: 'seqno-mismatch',
  133: 'seqno-mismatch',
  34: 'wallet-id-mismatch',
  134: 'wallet-id-mismatch',
  35: 'invalid-signature',
  135: 'invalid-signature',
  36: 'expired',
  136: 'expired',
  13: 'out-of-gas',
  [-14]: 'out-of-gas',
  705: 'jetton-unauthorized',
  706: 'not-enough-jettons',
}

/**
 * Action-phase result codes that mean one thing. 36 here is an invalid destination,
 * not the wallet's `expired` (36), which can only come from the compute phase. 37 is
 * "Not enough GRAMs" and says so on its own.
 *
 * 40 is deliberately absent. It reads "Cannot process a message — not enough funds,
 * the message is too large, or its Merkle depth is too big", so naming it a funding
 * failure would send a user to top up their balance when the payload is what has to
 * change. Codes like it fall through to `no_funds` below, the only authoritative
 * funding signal in the phase.
 */
const actionResultCodeReasons: Record<number, TonTxFailureReason> = {
  36: 'invalid-destination',
  37: 'insufficient-funds',
}

/**
 * Human-readable explanations. Each says what happened and what to do; the
 * remedy matters more than the code, because the two failures that dominate
 * TON support — a replayed seqno and an expired `valid_until` — both look like
 * "the network rejected it" and have opposite fixes.
 */
const failureMessages: Record<TonTxFailureReason, string> = {
  'seqno-mismatch':
    'Another transaction from this wallet was processed first, so the network rejected this one as out of order. Check your history: if this transfer is not there, send it again.',
  expired:
    "The transaction's time window closed before the network processed it. Make sure your device's date and time are set automatically, then send it again.",
  'invalid-signature':
    'The wallet contract rejected the signature. Sign the transaction again; if it keeps failing, the wallet contract at this address does not match this vault.',
  'wallet-id-mismatch':
    'The transaction was built for a different wallet contract version than the one deployed at this address.',
  'insufficient-funds':
    'Not enough TON to cover the amount plus network fees. Keep about 0.05 TON spare for fees and try again.',
  'out-of-gas': 'The transaction ran out of gas before it could finish. Attach more TON to the transfer and try again.',
  'invalid-destination': 'The destination address is not valid on TON. Check the address and try again.',
  'not-enough-jettons': 'This wallet does not hold enough of the token to send that amount.',
  'jetton-unauthorized':
    'The token contract refused the transfer because this wallet is not allowed to move these tokens.',
  'action-failed':
    'The wallet accepted the transaction but could not carry out the transfer, so nothing was sent. The network fee was still charged. Check the transaction and try again.',
  'action-partially-failed':
    'The wallet could not carry out at least one transfer in this transaction, and others in it may have gone through. The network fee was still charged. Check your transaction history before sending again.',
  aborted: 'The network aborted this transaction before it could carry out the transfer.',
  'contract-rejected': 'The contract rejected the transaction.',
}

const describe = (reason: TonTxFailureReason, exitCode: number | undefined): string =>
  reason === 'contract-rejected' && exitCode !== undefined
    ? `The contract rejected the transaction (exit code ${exitCode}).`
    : failureMessages[reason]

const makeFailure = (reason: TonTxFailureReason, phase: TonTxPhase, exitCode?: number): TonTxFailure => ({
  reason,
  phase,
  ...(exitCode === undefined ? {} : { exitCode }),
  message: describe(reason, exitCode),
})

/** Classifies a compute-phase exit code (0 and 1 are success and yield `undefined`). */
export const getTonComputeFailure = (exitCode: number | undefined): TonTxFailure | undefined => {
  if (exitCode === undefined || exitCode === 0 || exitCode === 1) return undefined

  return makeFailure(computeExitCodeReasons[exitCode] ?? 'contract-rejected', 'compute', exitCode)
}

type TonActionPhaseOutcome = {
  success?: boolean
  no_funds?: boolean
  result_code?: number
  skipped_actions?: number
  /** Outgoing messages the phase actually produced, when the node reports it. */
  msgs_created?: number
}

/**
 * Which generic explanation a failed action phase gets.
 *
 * Under `IGNORE_ERRORS` — the mode every Vultisig TON send uses — a failing action
 * is skipped and the remaining ones still go out, so a batch can lose one transfer
 * and deliver the rest. Telling that user nothing was sent and to try again is how a
 * duplicate transfer happens, so only the node's own `msgs_created: 0` earns the
 * "nothing was sent" wording. A node that reports nothing proves nothing either way
 * and gets the neutral explanation, which reads correctly for both outcomes.
 */
const genericActionReason = ({ msgs_created }: TonActionPhaseOutcome): TonTxFailureReason =>
  msgs_created === 0 ? 'action-failed' : 'action-partially-failed'

/**
 * Classifies a failed action phase. A result code the table names wins; an
 * unnamed one is read as a funding failure only when `no_funds` backs it, and
 * otherwise stays generic with the code attached. `no_funds` without any code
 * still means the transfer could not be paid for, and a skipped or unsuccessful
 * action with neither is generic — worded by `genericActionReason`, which will not
 * claim nothing was sent unless the node says so.
 */
export const getTonActionFailure = (action: TonActionPhaseOutcome | undefined): TonTxFailure | undefined => {
  if (!action) return undefined

  const { success, no_funds, result_code, skipped_actions } = action

  if (result_code !== undefined && result_code !== 0) {
    // A code the table does not name is a funding failure only when the node says so.
    const reason =
      actionResultCodeReasons[result_code] ?? (no_funds === true ? 'insufficient-funds' : genericActionReason(action))

    return makeFailure(reason, 'action', result_code)
  }

  if (no_funds === true) return makeFailure('insufficient-funds', 'action')

  if (success === false || (skipped_actions ?? 0) > 0) return makeFailure(genericActionReason(action), 'action')

  return undefined
}

type TonTransactionOutcome = {
  aborted?: boolean
  compute_ph?: { exit_code?: number }
  action?: TonActionPhaseOutcome
}

/**
 * Explains why an indexed TON transaction failed, or `undefined` when it did
 * not. The compute phase is consulted first because it carries the specific
 * exit code; an aborted transaction with no readable phase is reported as such.
 */
export const getTonTxFailure = (description: TonTransactionOutcome): TonTxFailure | undefined =>
  getTonComputeFailure(description.compute_ph?.exit_code) ??
  getTonActionFailure(description.action) ??
  (description.aborted === true ? makeFailure('aborted', 'compute') : undefined)

const rejectionExitCodePattern = /exitcode=(-?\d+)/i

/**
 * Reads the wallet contract's exit code out of a toncenter `sendBoc` rejection
 * ("… inbound external message rejected by transaction …: exitcode=133, steps=49,
 * gas_used=0 …"). The message never reached the chain, so the code is always the
 * sender's wallet refusing it in its compute phase. Returns `undefined` for
 * transport errors and any other rejection shape.
 */
export const parseTonBroadcastRejection = (error: unknown): TonTxFailure | undefined => {
  const match = rejectionExitCodePattern.exec(String(extractErrorMsg(error)))
  if (!match) return undefined

  return getTonComputeFailure(Number(match[1]))
}

/**
 * A TON broadcast the sender's wallet contract refused, with the refusal
 * classified. `message` is the human-readable explanation so any consumer that
 * only prints `error.message` already shows the right remedy; the original
 * toncenter error stays in `cause`.
 */
export class TonBroadcastRejectedError extends Error {
  constructor(
    public readonly failure: TonTxFailure,
    cause: unknown
  ) {
    super(failure.message, { cause })
    this.name = 'TonBroadcastRejectedError'
  }
}
