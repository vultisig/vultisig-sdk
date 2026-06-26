// Unit test for the loop-depth truncation signal (backlog fix-10).
//
// When processMessageLoop exceeds MAX_MESSAGE_LOOP_DEPTH it used to clear the
// queued tool results and call ui.onDone() — the SAME success-shaped callback
// used on a clean finish — so a headless caller (ask --json / pipe) could not
// distinguish a depth-capped truncation from a completed turn. The fix emits a
// distinct typed AgentErrorCode.LOOP_DEPTH_EXCEEDED via ui.onError first.
//
// processMessageLoop is private; it's exercised via the prototype with a
// minimal `this`, matching the harness style in sessionConfirmGate.test.ts.
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentSession } from '../session'

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

describe('processMessageLoop — loop-depth cap truncation signal', () => {
  it('past the depth cap: emits LOOP_DEPTH_EXCEEDED, clears the queue, never hits the backend', async () => {
    const ui = makeUi()
    const sendMessageStream = vi.fn()
    // HARNESS PRECONDITION: `conversationId` MUST be truthy. The depth guard at
    // session.ts sits BELOW the `if (!this.conversationId) return` early-return at
    // the top of processMessageLoop. A falsy conversationId would bail before the
    // guard is ever reached, and this test would pass vacuously (onError never
    // called, queue never touched) for the wrong reason. Keep it set.
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      cachedContext: { addresses: {} },
      config: { askMode: true, verbose: false },
      // Queued results that the old success-shaped exit silently dropped.
      pendingToolResults: [{ tool: 'vault_coin', success: true, data: {} }],
      abortController: null,
      client: { sendMessageStream },
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
    }

    // Any depth above the cap (16) trips the guard at the very top of the loop,
    // before any backend round-trip. 100 stays correct if the cap is retuned.
    await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, null, ui, 100)

    // The distinct truncation signal — this is the red-then-green lock: the old
    // code called only ui.onDone() here, so onError was never invoked.
    expect(ui.onError).toHaveBeenCalledTimes(1)
    expect(ui.onError.mock.calls[0][1]).toBe(AgentErrorCode.LOOP_DEPTH_EXCEEDED)

    // onDone() still fires as the turn terminator (pipe consumers read until
    // `done`), but only AFTER the error — the code, not onDone, is the signal.
    expect(ui.onDone).toHaveBeenCalledTimes(1)
    expect(ui.onError.mock.invocationCallOrder[0]).toBeLessThan(ui.onDone.mock.invocationCallOrder[0])

    // Truncated mid-flight: the queued results must not leak into the next turn.
    expect(fakeThis.pendingToolResults).toHaveLength(0)

    // The guard fires before any stream call — no extra backend turn.
    expect(sendMessageStream).not.toHaveBeenCalled()
  })
})
