/**
 * `hasUnacknowledgedBroadcastResult` — the pure discriminator behind the
 * ACK_FAILED gate (audit F1, review item 2).
 *
 * A queued tool result carrying a real `tx_hash` means a broadcast landed on
 * chain but its follow-up `recent_actions` report was never delivered — the
 * genuine ack-failure case (exit 8). Anything else (no broadcast, a failed sign,
 * an already-delivered/empty queue) must NOT be tagged ACK_FAILED, so a later
 * unrelated retryable error keeps its own classification.
 */
import { describe, expect, it } from 'vitest'

import { hasUnacknowledgedBroadcastResult } from '../session'
import type { RecentAction } from '../types'

describe('hasUnacknowledgedBroadcastResult', () => {
  it('true when a successful broadcast result with a tx_hash is still queued', () => {
    const queue: RecentAction[] = [
      { tool: 'sign_tx', success: true, data: { tx_hash: '0xabc', chain: 'Ethereum', status: 'pending' } },
    ]
    expect(hasUnacknowledgedBroadcastResult(queue)).toBe(true)
  })

  it('false for an empty queue (no broadcast happened)', () => {
    expect(hasUnacknowledgedBroadcastResult([])).toBe(false)
  })

  it('false when the only queued results are non-broadcast tools', () => {
    const queue: RecentAction[] = [{ tool: 'vault_balance', success: true, data: { amount: '1.0' } }]
    expect(hasUnacknowledgedBroadcastResult(queue)).toBe(false)
  })

  it('false for a FAILED sign result (nothing broadcast — e.g. a duplicate refusal)', () => {
    const queue: RecentAction[] = [
      { tool: 'sign_tx', success: false, data: { code: 'DUPLICATE_BROADCAST', error: 'refused' } },
    ]
    expect(hasUnacknowledgedBroadcastResult(queue)).toBe(false)
  })

  it('false when a result has an empty/absent tx_hash', () => {
    expect(hasUnacknowledgedBroadcastResult([{ tool: 'sign_tx', success: true, data: { tx_hash: '' } }])).toBe(false)
    expect(hasUnacknowledgedBroadcastResult([{ tool: 'sign_tx', success: true, data: {} }])).toBe(false)
  })

  it('true when a broadcast result is queued alongside other results', () => {
    const queue: RecentAction[] = [
      { tool: 'vault_balance', success: true, data: { amount: '1.0' } },
      { tool: 'sign_tx', success: true, data: { tx_hash: '0xdeadbeef', chain: 'Base' } },
    ]
    expect(hasUnacknowledgedBroadcastResult(queue)).toBe(true)
  })
})
