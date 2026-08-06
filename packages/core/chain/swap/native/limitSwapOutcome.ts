import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { thorchainMidgardBaseUrl } from '../../chains/cosmos/thor/lp/pools'

/**
 * What happened to a limit order that has left the queue.
 *
 * `unresolved` is the load-bearing member: it means "no answer yet", never an
 * outcome. The distinction between "the chain says refund" and "Midgard didn't
 * answer" is the entire safety property of this module — an infrastructure
 * hiccup must not close a live order.
 */
export const limitSwapOutcomes = ['filled', 'refunded', 'cancelled', 'expired', 'unresolved'] as const

export type LimitSwapOutcome = (typeof limitSwapOutcomes)[number]

/**
 * The refund reasons THORChain writes when it closes a limit order, matched by
 * stem because detail is appended behind a separator
 * (`"limit swap cancelled; fail to refund …"`).
 *
 * The completion stem is the surprising one: THORNode's advanced-swap-queue
 * manager (`manager_adv_swap_queue_current.go`) writes
 * `"swap has been completed."` via `settleSwap` whenever `IsDone(...)` is
 * true — which fires on TTL elapse as well as full execution (the source
 * comment directly above the call reads "Check if our swap is already
 * completed, ie a limit swap has expired"). `settleSwap` only emits a refund
 * action when `state.deposit > state.in`, i.e. an unfilled remainder is being
 * returned; a fully-filled order has `deposit == in` and emits no refund
 * action at all. So a `refund` action carrying this stem is TTL-expiry closing
 * out the unfilled remainder, never a fill confirmation — verified live on
 * mainnet (tx 5CB3698C…40F9C3): placed at height 27179916, refunded at height
 * 27194316 (exactly +14400 blocks, matching the memo's own TTL), with the
 * refund returning the full RUNE deposit to the sender and zero of the
 * destination asset ever paid out.
 */
const completedReasonStem = 'swap has been completed'
const cancelledReasonStem = 'limit swap cancelled'
const expiredReasonStem = 'limit swap expired'

/**
 * Whether `value` IS `stem` or is `stem` followed by appended detail.
 *
 * The match must stop at a word boundary: a reworded reason that merely runs
 * the stem on into another word (`"limit swap cancelledness"`) is a DIFFERENT
 * reason and must fall to the fail-closed `refunded`, not be read as a
 * cancellation.
 */
const hasStem = (value: string, stem: string): boolean => {
  if (!value.startsWith(stem)) return false
  const boundary = value.slice(stem.length, stem.length + 1)
  if (!boundary) return true
  return !/[a-z0-9]/i.test(boundary)
}

/**
 * Read THORChain's own account of why an order closed.
 *
 * Pure, and separate from the HTTP that fetches it, because this mapping is
 * the whole of the decision. A reason that is missing or that THORChain has
 * since reworded degrades to `refunded` — "the funds came back and we cannot
 * say why" — which is today's truthful answer, never a wrong one.
 */
export const getLimitSwapCloseOutcome = (refundReason: string | undefined | null): LimitSwapOutcome => {
  const normalized = refundReason?.trim().toLowerCase()
  if (!normalized) {
    return 'refunded'
  }
  if (hasStem(normalized, completedReasonStem)) {
    return 'expired'
  }
  if (hasStem(normalized, cancelledReasonStem)) {
    return 'cancelled'
  }
  if (hasStem(normalized, expiredReasonStem)) {
    return 'expired'
  }
  return 'refunded'
}

/** The slice of a Midgard action this classification reads. */
export type MidgardLimitSwapAction = {
  type?: string
  /** Whether the action's OUTBOUND settled — not what happened to the order. */
  status?: string
  metadata?: {
    refund?: {
      reason?: string
    }
  }
}

/**
 * Classify a closed order's Midgard actions into an outcome.
 *
 * A `refund` action wins over everything, and its reason is read regardless of
 * the refund's `status`. Two facts make that safe: callers only ask after the
 * queue has already said the order is gone (so "did it close" is answered),
 * and the reason is set when the refund is created, so reading it while the
 * outbound is still pending is not premature. Gating on `status` instead is a
 * known bug: a refund outbound failing on fees can stay pending indefinitely,
 * leaving the order unresolved forever.
 *
 * The refund must also never fall through to the fill check below it: an order
 * that partially filled and THEN closed has both actions indexed, and reading
 * the older fill would report it FILLED, terminally, on the strength of a fill
 * that was only part of the story.
 *
 * Only the placement action, an outbound still in flight, or nothing at all —
 * either way `unresolved`: Midgard indexing lag, not an answer.
 */
export const classifyLimitSwapActions = (actions: MidgardLimitSwapAction[]): LimitSwapOutcome => {
  const refund = actions.find(action => action.type?.toLowerCase() === 'refund')
  if (refund) {
    return getLimitSwapCloseOutcome(refund.metadata?.refund?.reason)
  }
  if (actions.some(action => action.type?.toLowerCase() === 'swap' && action.status?.toLowerCase() === 'success')) {
    return 'filled'
  }
  return 'unresolved'
}

/**
 * Midgard keys every chain's txid as uppercase hex with NO `0x` prefix; an
 * L1-sourced order's lookup returns nothing without this normalization.
 * Idempotent for an already-normalized hash.
 */
const toMidgardTxid = (txHash: string): string =>
  (txHash.startsWith('0x') || txHash.startsWith('0X') ? txHash.slice(2) : txHash).toUpperCase()

type MidgardActionsResponse = {
  actions?: MidgardLimitSwapAction[]
}

/**
 * Resolve what happened to a limit order that has left the queue, from Midgard
 * `/v2/actions`.
 *
 * Midgard is read directly rather than through a generic tx-status provider
 * on purpose: a generic provider folds HTTP 429/5xx into "not found", and here
 * that difference is everything — rate limits, server errors, timeouts and
 * decode failures are all `unresolved`, never an outcome.
 */
export const resolveLimitSwapOutcome = (inboundTxHash: string): Promise<LimitSwapOutcome> =>
  withFallback(
    attempt(async () => {
      const response = await queryUrl<MidgardActionsResponse>(
        `${thorchainMidgardBaseUrl}/v2/actions?txid=${encodeURIComponent(toMidgardTxid(inboundTxHash))}`
      )
      return classifyLimitSwapActions(Array.isArray(response.actions) ? response.actions : [])
    }),
    'unresolved'
  )
