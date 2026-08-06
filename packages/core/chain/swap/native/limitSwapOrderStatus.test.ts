import { describe, expect, it } from 'vitest'

import { isTerminalLimitSwapOrderStatus, limitSwapOrderStatuses } from './limitSwapOrderStatus'

describe('limitSwapOrderStatuses', () => {
  // Trackers stop polling on terminal; a live status wrongly marked terminal
  // freezes a resting order forever, so the split is pinned.
  it('splits live from terminal statuses', () => {
    const terminal = limitSwapOrderStatuses.filter(isTerminalLimitSwapOrderStatus)

    expect(terminal).toEqual(['filled', 'refunded', 'expired', 'cancelled'])
    expect(isTerminalLimitSwapOrderStatus('pending')).toBe(false)
    expect(isTerminalLimitSwapOrderStatus('resting')).toBe(false)
  })
})
