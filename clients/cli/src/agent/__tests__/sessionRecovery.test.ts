// Mid-turn SSE disconnect recovery (audit cat4-cli-disconnect-recovery).
//
// A dropped SSE stream must not lose the assistant's answer or a tx_ready
// signable card. The backend keeps processing on a detached context and
// persists the message; the CLI recovers it by polling /messages/since.
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
    transactions: [] as any[],
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
      client: { messagesSince },
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
    }
  }

  it('recovers the persisted answer + tx_ready that the dropped stream lost', async () => {
    // BEFORE: the stream dropped mid-turn — no message, no transactions.
    const streamResult = makeStreamResult({
      disconnected: true,
      serverNow: '1718870400000',
    })
    expect(streamResult.message).toBeNull()
    expect(streamResult.transactions).toHaveLength(0)

    const txReadyData = {
      chain: 'Ethereum',
      action: 'send',
      send_tx: { to: '0xabc', value: '1' },
    }
    const messagesSince = vi.fn(async () => ({
      messages: [
        recoveredAssistant({
          parts: [
            { type: 'text', text: 'Here is your balance: 1.5 ETH' },
            { type: 'data-tx_ready', id: 'tx1', data: txReadyData },
          ],
        }),
      ],
      cursor: 'opaque-cursor-1',
    }))
    const onTxReady = vi.fn()

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(
      makeRecoveryThis(messagesSince),
      streamResult,
      onTxReady
    )

    // AFTER: the answer and the tx_ready card are both recovered.
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
    expect(streamResult.transactions).toEqual([txReadyData])
    expect(onTxReady).toHaveBeenCalledExactlyOnceWith(txReadyData)

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

describe('processMessageLoop — disconnect recovery wiring (end-to-end)', () => {
  function makeHarness(opts: { recover: boolean }) {
    const txReadyData = {
      chain: 'Ethereum',
      action: 'send',
      send_tx: { to: '0xR', value: '1' },
    }
    const calls: string[] = []
    const client = {
      sendMessageStream: vi.fn(async (_conv: string, _req: any, _cb: any) => {
        calls.push('stream')
        // Turn 1 drops mid-flight; turn 2 (after the recovered tx is signed and
        // reported) returns a clean closing message.
        if (calls.filter(c => c === 'stream').length === 1) {
          return makeStreamResult({
            disconnected: true,
            serverNow: '1718870400000',
          })
        }
        return makeStreamResult({
          message: { content: 'done' },
          finished: true,
        })
      }),
      messagesSince: vi.fn(async () => ({
        messages: [
          recoveredAssistant({
            parts: opts.recover
              ? [
                  { type: 'text', text: 'Recovered answer' },
                  { type: 'data-tx_ready', id: 'tx1', data: txReadyData },
                ]
              : undefined,
            content: opts.recover ? 'Recovered answer' : '',
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
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      recoverDisconnectedTurn: (AgentSession.prototype as any).recoverDisconnectedTurn,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
    }
    const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'whats my balance', ui, 0)
    return { run, ui, client, executor }
  }

  it('recovers answer + tx_ready after a drop, signs through the gate, completes', async () => {
    const h = makeHarness({ recover: true })
    await h.run()

    // The drop was signalled to the consumer (pipe emits a `reconnecting` event).
    expect(h.ui.onReconnecting).toHaveBeenCalledOnce()
    // The recovered answer surfaced to the user.
    expect(h.ui.onAssistantMessage).toHaveBeenCalledWith('Recovered answer')
    // The recovered tx_ready flowed through the confirm/sign gate.
    expect(h.ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(h.executor.storeServerTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'Ethereum', action: 'send' })
    )
    expect(h.executor.signTxFromBuffer).toHaveBeenCalledOnce()
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Ethereum', 'pending', undefined)
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })

  it('happy path (no disconnect) does not poll /messages/since', async () => {
    const txReadyData = { chain: 'Ethereum' }
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
    void txReadyData
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
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      recoverDisconnectedTurn: (AgentSession.prototype as any).recoverDisconnectedTurn,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
    }

    await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'hi', ui, 0)

    expect(client.messagesSince).not.toHaveBeenCalled()
    expect(ui.onReconnecting).not.toHaveBeenCalled()
    expect(ui.onAssistantMessage).toHaveBeenCalledWith('hello')
    expect(ui.onDone).toHaveBeenCalledOnce()
  })
})
