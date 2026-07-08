// Mid-turn SSE disconnect recovery (audit cat4-cli-disconnect-recovery).
//
// A dropped SSE stream must not lose the assistant's answer. The backend keeps
// processing on a detached context and persists the message; the CLI recovers
// it by polling /messages/since.
//
// #927 Phase 2: a signable transaction is NEVER recovered — the signable payload
// rides tool-output-available, which the persisted parts do not reconstruct — so
// a recovered turn that ran a signable tool warns to re-run rather than signing.
//
// These exercise the private recovery methods + the processMessageLoop wiring
// through the prototype with a minimal `this`, so no real vault/network is hit.
import { describe, expect, it, vi } from 'vitest'

import { AgentSession, serverNowToIso } from '../session'
import type { ConversationMessage } from '../types'

function makeStreamResult(over: Partial<any> = {}) {
  return {
    fullText: '',
    suggestions: [],
    message: null as ConversationMessage | null,
    finished: false,
    disconnected: false,
    serverNow: null as string | null,
    ...over,
  }
}

function recoveredAssistant(over: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'm-recovered',
    conversation_id: 'conv-1',
    role: 'assistant',
    content: 'Here is your balance: 1.5 ETH',
    content_type: 'text',
    created_at: '2026-06-20T00:00:01Z',
    ...over,
  }
}

describe('serverNowToIso', () => {
  it('converts epoch millis header to RFC3339', () => {
    expect(serverNowToIso('1718870400000')).toBe('2024-06-20T08:00:00.000Z')
  })
  it('returns null for absent/garbage headers (caller falls back to local clock)', () => {
    expect(serverNowToIso(null)).toBeNull()
    expect(serverNowToIso('')).toBeNull()
    expect(serverNowToIso('not-a-number')).toBeNull()
    expect(serverNowToIso('0')).toBeNull()
  })
})

describe('recoverDisconnectedTurn — before/after differential', () => {
  function makeRecoveryThis(messagesSince: any) {
    return {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      config: { verbose: false },
      recoveryMaxPolls: 5,
      recoveryPollIntervalMs: 0,
      client: { messagesSince, setAuthToken: vi.fn() },
      // The recovery poll now routes through withAuthRetry (M1). These cases
      // never throw an auth error, so the helper just passes the call through;
      // its revoked-token behaviour is covered in sessionAuthRetry.test.ts.
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
    }
  }

  it('recovers the persisted answer + balance card that the dropped stream lost', async () => {
    // BEFORE: the stream dropped mid-turn — no message.
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: '1718870400000',
    })
    expect(streamResult.message).toBeNull()

    const balanceCard = { surface: 'balance_summary', accounts: [] }
    const messagesSince = vi.fn(async () => ({
      messages: [
        recoveredAssistant({
          parts: [
            { type: 'text', text: 'Here is your balance: 1.5 ETH' },
            { type: 'data-balance_summary', id: 'bs1', data: balanceCard },
          ],
        }),
      ],
      cursor: 'opaque-cursor-1',
    }))
    const onBalanceSummary = vi.fn()

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      onBalanceSummary
    )

    // AFTER: the answer and the (read-only) balance card are both recovered.
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
    expect(onBalanceSummary).toHaveBeenCalledExactlyOnceWith(balanceCard)

    // Bootstrap poll anchors on the server clock (X-Server-Now), not Date.now().
    expect(messagesSince).toHaveBeenCalledWith('conv-1', {
      since: '2024-06-20T08:00:00.000Z',
    })
  })

  it('keeps polling (cursor round-trip) until the answer lands, then stops', async () => {
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: '1718870400000',
    })
    const messagesSince = vi
      .fn()
      .mockResolvedValueOnce({ messages: [], cursor: 'cursor-A' }) // empty poll
      .mockResolvedValueOnce({
        messages: [recoveredAssistant()],
        cursor: 'cursor-B',
      })

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      undefined
    )

    expect(messagesSince).toHaveBeenCalledTimes(2)
    // First poll bootstraps with `since`; second round-trips the opaque cursor.
    expect(messagesSince).toHaveBeenNthCalledWith(1, 'conv-1', {
      since: '2024-06-20T08:00:00.000Z',
    })
    expect(messagesSince).toHaveBeenNthCalledWith(2, 'conv-1', {
      cursor: 'cursor-A',
    })
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
  })

  it('is bounded: gives up after recoveryMaxPolls when nothing ever persists', async () => {
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: '1718870400000',
    })
    const messagesSince = vi.fn(async () => ({ messages: [], cursor: 'c' }))

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      undefined
    )

    expect(messagesSince).toHaveBeenCalledTimes(5) // recoveryMaxPolls
    expect(streamResult.message).toBeNull() // no worse than today — turn just ends
  })

  it('without a server-clock anchor (no X-Server-Now), still recovers the text answer via the local-clock fallback', async () => {
    // A local-clock fallback anchor recovers the TEXT answer (at worst cosmetic if
    // it reaches a prior turn). Nothing signable is ever replayed in Phase 2, so
    // there is no fund-safety gate on the anchor anymore — only the text is at stake.
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: null, // no X-Server-Now → local-clock fallback anchor
    })
    const messagesSince = vi.fn(async () => ({
      messages: [
        recoveredAssistant({
          parts: [{ type: 'text', text: 'Here is your balance: 1.5 ETH' }],
        }),
      ],
      cursor: 'c',
    }))

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      undefined
    )

    // The text answer is recovered from the local-clock-anchored poll.
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
    expect(messagesSince).toHaveBeenCalledWith('conv-1', expect.objectContaining({ since: expect.any(String) }))
  })

  it('survives a transient poll error and recovers on a later attempt', async () => {
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: '1718870400000',
    })
    const messagesSince = vi
      .fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce({ messages: [recoveredAssistant()], cursor: 'c' })

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      undefined
    )

    expect(messagesSince).toHaveBeenCalledTimes(2)
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
  })
})

describe('applyRecoveredMessage — signable tool fail-closed (Phase 2: tool-output not reconstructable)', () => {
  const applyRecovered = (AgentSession.prototype as any).applyRecoveredMessage

  it('warns LOUDLY and signs NOTHING when a recovered turn ran a FLAT signable tool', () => {
    // A flat signable tool (polymarket / build_custom_*) emits its signable output
    // on tool-output-available — which the recovery path does NOT reconstruct. So a
    // mid-turn disconnect on such a tool must FAIL CLOSED (sign nothing) and warn,
    // never silently drop. If this branch were reverted, no other test catches it.
    const streamResult = makeStreamResult({ disconnected: true })
    const onBalanceSummary = vi.fn()
    const writes: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })
    const msg = recoveredAssistant({
      content: 'Deposited into Polymarket',
      parts: [
        { type: 'text', text: 'Deposited into Polymarket' },
        { type: 'tool-polymarket_deposit', data: { chain: 'Polygon' } },
      ],
    })

    applyRecovered.call({}, msg, streamResult, onBalanceSummary)
    writeSpy.mockRestore()

    // Fail-closed: nothing signable is reconstructed, and the drop is announced LOUDLY.
    const warned = writes.some(w => w.includes('[session][recovery]') && w.includes('polymarket_deposit'))
    expect(warned).toBe(true)
  })

  it('warns for a recovered PREP signable tool too (execute_* rides tool-output, no data-tx_ready)', () => {
    // Phase 2 broadens the warning past flat tools: execute_send/swap/contract_call
    // are prep signable tools whose payload also rides tool-output — equally
    // unreconstructable on recovery. The warning must fire for them too.
    const streamResult = makeStreamResult({ disconnected: true })
    const writes: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })
    const msg = recoveredAssistant({
      content: 'Prepared your transfer',
      parts: [
        { type: 'text', text: 'Prepared your transfer' },
        { type: 'tool-execute_send', data: {} },
      ],
    })

    applyRecovered.call({}, msg, streamResult, undefined)
    writeSpy.mockRestore()

    const warned = writes.some(w => w.includes('[session][recovery]') && w.includes('execute_send'))
    expect(warned).toBe(true)
  })

  it('does NOT warn when the recovered turn ran only a NON-signable tool', () => {
    // A read tool (get_balances) is not a signing source — recovering its turn has
    // no unsigned-tx gap, so the fail-closed warning must NOT fire (else every
    // recovered read turn nags).
    const streamResult = makeStreamResult({ disconnected: true })
    const onBalanceSummary = vi.fn()
    const writes: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })
    const msg = recoveredAssistant({
      content: 'Your balance is 1.5 ETH',
      parts: [
        { type: 'text', text: 'Your balance is 1.5 ETH' },
        { type: 'tool-get_balances', data: {} },
      ],
    })

    applyRecovered.call({}, msg, streamResult, onBalanceSummary)
    writeSpy.mockRestore()

    const warned = writes.some(w => w.includes('[session][recovery]'))
    expect(warned).toBe(false)
  })
})

describe('processMessageLoop — disconnect recovery wiring (end-to-end)', () => {
  function makeHarness() {
    const calls: string[] = []
    const client = {
      sendMessageStream: vi.fn(async (_conv: string, _req: any, _cb: any) => {
        calls.push('stream')
        // Turn 1 drops mid-flight; the persisted answer is recovered by polling.
        return makeStreamResult({
          disconnected: true,
          serverNow: '1718870400000',
        })
      }),
      messagesSince: vi.fn(async () => ({
        messages: [
          recoveredAssistant({
            parts: [
              { type: 'text', text: 'Recovered answer' },
              // The recovered turn ran a signable tool whose payload rode
              // tool-output — unreconstructable, so nothing is signed (warns).
              { type: 'tool-execute_send', data: {} },
            ],
            content: 'Recovered answer',
          }),
        ],
        cursor: 'c',
      })),
    }
    const executor = {
      storeServerTransaction: vi.fn(() => true),
      setPassword: vi.fn(),
      getPendingSummary: () => 'send 1 ETH on Ethereum to 0xR',
      signTxFromBuffer: vi.fn(async () => ({
        tool: 'sign_tx',
        success: true,
        data: { tx_hash: '0xfeed', chain: 'Ethereum' },
      })),
      clearPendingTransaction: vi.fn(),
    }
    const ui = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSuggestions: vi.fn(),
      onTxStatus: vi.fn(),
      onError: vi.fn(),
      onReconnecting: vi.fn(),
      onDone: vi.fn(),
      requestPassword: vi.fn(async () => 'pw'),
      requestConfirmation: vi.fn(async () => true),
    }
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      cachedContext: { addresses: {} },
      config: { password: 'pw', askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      recoveryMaxPolls: 5,
      recoveryPollIntervalMs: 0,
      client,
      executor,
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      reportDeferredSignable: (AgentSession.prototype as any).reportDeferredSignable,
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      recoverDisconnectedTurn: (AgentSession.prototype as any).recoverDisconnectedTurn,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
      // No `vault` here, so confirmBroadcastedTx early-returns.
      confirmBroadcastedTx: (AgentSession.prototype as any).confirmBroadcastedTx,
      emitAndConfirmTx: (AgentSession.prototype as any).emitAndConfirmTx,
    }
    const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'send 1 ETH', ui, 0)
    return { run, ui, client, executor }
  }

  it('recovers the answer after a drop, signs NOTHING (tool-output not reconstructable), completes', async () => {
    const h = makeHarness()
    const writes: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })
    await h.run()
    writeSpy.mockRestore()

    // The drop was signalled to the consumer (pipe emits a `reconnecting` event).
    expect(h.ui.onReconnecting).toHaveBeenCalledOnce()
    // The recovered answer surfaced to the user.
    expect(h.ui.onAssistantMessage).toHaveBeenCalledWith('Recovered answer')
    // Phase 2: a recovered signable tool is NEVER signed — nothing buffered/signed.
    expect(h.executor.storeServerTransaction).not.toHaveBeenCalled()
    expect(h.executor.signTxFromBuffer).not.toHaveBeenCalled()
    expect(h.ui.requestConfirmation).not.toHaveBeenCalled()
    expect(h.ui.onTxStatus).not.toHaveBeenCalled()
    // …and the drop is announced LOUDLY so the user re-runs.
    expect(writes.some(w => w.includes('[session][recovery]') && w.includes('execute_send'))).toBe(true)
    // Only one stream call — no sign result to recurse on.
    expect(h.client.sendMessageStream).toHaveBeenCalledOnce()
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })

  it('happy path (no disconnect) does not poll /messages/since', async () => {
    const client = {
      sendMessageStream: vi.fn(async () => makeStreamResult({ message: { content: 'hello' }, finished: true })),
      messagesSince: vi.fn(),
    }
    const ui = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSuggestions: vi.fn(),
      onTxStatus: vi.fn(),
      onError: vi.fn(),
      onReconnecting: vi.fn(),
      onDone: vi.fn(),
      requestPassword: vi.fn(async () => 'pw'),
      requestConfirmation: vi.fn(async () => true),
    }
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      cachedContext: { addresses: {} },
      config: { password: 'pw', askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      recoveryMaxPolls: 5,
      recoveryPollIntervalMs: 0,
      client,
      executor: {
        storeServerTransaction: vi.fn(() => true),
        setPassword: vi.fn(),
      },
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      reportDeferredSignable: (AgentSession.prototype as any).reportDeferredSignable,
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      recoverDisconnectedTurn: (AgentSession.prototype as any).recoverDisconnectedTurn,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    }

    await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'hi', ui, 0)

    expect(client.messagesSince).not.toHaveBeenCalled()
    expect(ui.onReconnecting).not.toHaveBeenCalled()
    expect(ui.onAssistantMessage).toHaveBeenCalledWith('hello')
    expect(ui.onDone).toHaveBeenCalledOnce()
  })
})
