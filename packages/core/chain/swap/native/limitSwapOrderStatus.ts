/**
 * Every state a tracked limit order can be in, shared across platforms so all
 * clients render the same lifecycle.
 *
 * - `pending` — broadcast, not yet observed in THORChain's queue.
 * - `resting` — observed in the advanced-swap-queue, waiting for its price
 *   (possibly partially filled; the fill split lives on the queue entry).
 * - `filled` — executed; an outbound in the target asset settled.
 * - `refunded` — closed with the funds returned and no reason we recognise.
 *   Deliberately distinct from `expired`: a placement rejected outright (halted
 *   pool, bad memo) also refunds, within seconds, with no TTL elapsed.
 * - `expired` — THORChain closed it because its TTL elapsed (its own words).
 * - `cancelled` — THORChain closed it because a cancel matched it. An observed
 *   outcome here; *building* a cancel is a separate concern.
 */
export const limitSwapOrderStatuses = ['pending', 'resting', 'filled', 'refunded', 'expired', 'cancelled'] as const

export type LimitSwapOrderStatus = (typeof limitSwapOrderStatuses)[number]

const terminalStatuses: readonly LimitSwapOrderStatus[] = ['filled', 'refunded', 'expired', 'cancelled']

/**
 * Whether a status is final — nothing about the order can change, so trackers
 * stop polling it and history views may render it as settled.
 */
export const isTerminalLimitSwapOrderStatus = (status: LimitSwapOrderStatus): boolean =>
  terminalStatuses.includes(status)
