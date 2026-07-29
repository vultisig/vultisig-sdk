import { describe, expect, it } from 'vitest'

import { classifyLimitSwapActions, getLimitSwapCloseOutcome, MidgardLimitSwapAction } from './limitSwapOutcome'

const refund = (reason?: string, status = 'pending'): MidgardLimitSwapAction => ({
  type: 'refund',
  status,
  metadata: { refund: { reason } },
})

const fill = (status = 'success'): MidgardLimitSwapAction => ({
  type: 'swap',
  status,
})

describe('getLimitSwapCloseOutcome', () => {
  it.each([
    ['limit swap cancelled', 'cancelled'],
    ['limit swap cancelled; fail to refund: dust', 'cancelled'],
    ['Limit Swap Expired', 'expired'],
    ['limit swap expired: TTL elapsed', 'expired'],
  ] as const)('reads %s as %s', (reason, outcome) => {
    expect(getLimitSwapCloseOutcome(reason)).toBe(outcome)
  })

  // A reworded reason that runs the stem into another word is a DIFFERENT
  // reason and must degrade to the fail-closed refunded, not read as a cancel.
  it.each([
    ['limit swap cancelledness'],
    ['limit swap expiredish'],
    ['some entirely new reason'],
    [undefined],
    [''],
    ['   '],
  ])('degrades %s to refunded', reason => {
    expect(getLimitSwapCloseOutcome(reason)).toBe('refunded')
  })
})

describe('classifyLimitSwapActions', () => {
  it('classifies a successful swap action as filled', () => {
    expect(classifyLimitSwapActions([fill()])).toBe('filled')
  })

  // Verified live on mainnet (tx 5CB3698C…40F9C3): this shape is a TTL-expired
  // limit order, NOT a fill. THORNode's settleSwap writes "swap has been
  // completed." on TTL elapse (IsDone(...) is true on expiry as well as full
  // execution) and only emits a refund action when an unfilled remainder is
  // being returned — a fully-filled order has deposit == in and emits no
  // refund action at all. On-chain the refund returned the full deposit to
  // the sender and zero of the destination asset was ever paid out.
  it('classifies the live TTL-expiry refund shape as expired, not filled', () => {
    expect(
      classifyLimitSwapActions([
        refund('swap has been completed.', 'success'),
        { type: 'limit_swap', status: 'success' },
      ])
    ).toBe('expired')
  })

  // The refund's reason is authoritative regardless of its status: the refund
  // OUTBOUND settling is a separate leg, and one failing on fees can stay
  // pending indefinitely — gating on it left orders unresolved forever.
  it('reads a pending refund as an outcome, not as unresolved', () => {
    expect(classifyLimitSwapActions([refund('limit swap expired', 'pending')])).toBe('expired')
  })

  // An order that partially filled and THEN closed has both actions indexed.
  // What closed it is the refund; reading the older fill would report FILLED,
  // terminally, on the strength of a fill that was only part of the story.
  it('lets a refund win over an indexed fill', () => {
    expect(classifyLimitSwapActions([fill(), refund('limit swap cancelled')])).toBe('cancelled')
  })

  it('classifies a refund without a recognised reason as refunded', () => {
    expect(classifyLimitSwapActions([refund(undefined, 'success')])).toBe('refunded')
  })

  // "No actions" is Midgard indexing lag, not an answer.
  it('reports no actions as unresolved', () => {
    expect(classifyLimitSwapActions([])).toBe('unresolved')
  })

  // The placement's own action and an in-flight outbound are not outcomes.
  it.each([
    ['only the placement action', [{ type: 'limit_swap', status: 'success' }]],
    ['a swap whose outbound has not settled', [fill('pending')]],
  ] as const)('reports %s as unresolved', (_label, actions) => {
    expect(classifyLimitSwapActions([...actions])).toBe('unresolved')
  })
})
