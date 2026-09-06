import { describe, expect, it } from 'vitest'

import { getTxStatusEvent } from './tx-status-event'

describe('getTxStatusEvent', () => {
  it.each(['error', 'expired'] as const)('maps %s to the failed bridge event', status => {
    expect(getTxStatusEvent(status)).toBe('vault:transactionFailed')
  })

  it('maps success to the confirmed bridge event', () => {
    expect(getTxStatusEvent('success')).toBe('vault:transactionConfirmed')
  })

  it.each(['pending', 'not_found'] as const)('does not emit a terminal event for %s', status => {
    expect(getTxStatusEvent(status)).toBeUndefined()
  })
})
