/**
 * `AgentSession.sendMessage` ACK-failure capture (audit F1, review item 2) —
 * the REAL session wiring, not the pure helper or the command-level gate.
 *
 * When a turn throws, `sendMessage`'s catch MUST snapshot whether a
 * just-broadcast (still-undelivered) tool result was queued BEFORE it wipes
 * `pendingToolResults`. If the snapshot ran after the wipe, every thrown turn
 * would report "no unacknowledged broadcast" and the ACK_FAILED (exit 8)
 * fund-safety signal would silently vanish. This test locks the capture-then-
 * clear ordering: swapping the two lines in session.ts must turn it red.
 *
 * Uses the prototype-call harness (private-method style from
 * sessionLoopDepth.test.ts): a minimal `this` + a stubbed `processMessageLoop`
 * that pushes a result then throws, so we exercise the actual catch block.
 */
import { describe, expect, it, vi } from 'vitest'

import { AgentSession } from '../session'
import type { RecentAction } from '../types'

function makeUi() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onAssistantMessage: vi.fn(),
    onSuggestions: vi.fn(),
    onTxStatus: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
    requestPassword: vi.fn(async () => 'pw'),
    requestConfirmation: vi.fn(async () => true),
  }
}

/** Minimal `this` for AgentSession.prototype.sendMessage (harness style: `any`). */
function fakeSession(queueOnThrow: RecentAction[]): any {
  return {
    conversationId: 'conv-1',
    publicKey: 'pk',
    // Real vault shape buildMinimalContext reads; empty chains → no network.
    vault: { name: 'v', publicKeys: { ecdsa: 'e', eddsa: 'd' }, hexChainCode: 'cc', chains: [] },
    cachedContext: null,
    config: { askMode: true, verbose: false },
    pendingToolResults: [] as RecentAction[],
    abortController: null,
    unacknowledgedBroadcastAtError: false,
    // Emulate a turn that queued some results then threw (e.g. the follow-up
    // recent_actions report failing after a broadcast).
    processMessageLoop: vi.fn(async function (this: { pendingToolResults: RecentAction[] }) {
      this.pendingToolResults.push(...queueOnThrow)
      throw new Error('backend 503 reporting recent_actions after broadcast')
    }),
    sendMessage: (AgentSession.prototype as any).sendMessage,
    hasUnacknowledgedBroadcast: (AgentSession.prototype as any).hasUnacknowledgedBroadcast,
  }
}

describe('AgentSession.sendMessage — ACK-failure capture (item 2)', () => {
  it('captures an unacknowledged broadcast (queued tx_hash) BEFORE clearing the queue', async () => {
    const self = fakeSession([{ tool: 'sign_tx', success: true, data: { tx_hash: '0xcafef00d', chain: 'Ethereum' } }])
    await expect(self.sendMessage.call(self, 'hi', makeUi())).rejects.toThrow(/recent_actions/)
    // The queue was wiped (SF), but the snapshot taken first must survive.
    expect(self.pendingToolResults).toHaveLength(0)
    expect(self.hasUnacknowledgedBroadcast.call(self)).toBe(true)
  })

  it('does NOT flag when the thrown turn had no broadcast queued (later independent error)', async () => {
    const self = fakeSession([{ tool: 'vault_balance', success: true, data: { amount: '1.0' } }])
    await expect(self.sendMessage.call(self, 'hi', makeUi())).rejects.toThrow()
    expect(self.hasUnacknowledgedBroadcast.call(self)).toBe(false)
  })

  it('resets the flag at the start of a fresh turn', async () => {
    const self = fakeSession([{ tool: 'sign_tx', success: true, data: { tx_hash: '0xabc' } }])
    self.unacknowledgedBroadcastAtError = true // stale from a prior turn
    // A clean turn (processMessageLoop resolves) must clear it.
    self.processMessageLoop = vi.fn(async () => {})
    await self.sendMessage.call(self, 'hi', makeUi())
    expect(self.hasUnacknowledgedBroadcast.call(self)).toBe(false)
  })
})
