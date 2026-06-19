// Unit tests for the runPasswordGatedTool confirmation gate (security fix for
// vultisig-sdk#679: agent ask auto-signed any backend-returned envelope).
// The method is private; it's exercised via the prototype with a minimal
// `this` so no real vault / fs / network is touched.
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentSession } from '../session'
import type { RecentAction } from '../types'

function makeUi(approve: boolean) {
  return {
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    requestConfirmation: vi.fn(async (_msg: string) => approve),
    requestPassword: vi.fn(async () => 'pw'),
  }
}

function callGate(opts: {
  toolName: string
  ui: ReturnType<typeof makeUi>
  body: () => Promise<RecentAction>
  input?: Record<string, unknown>
  pendingSummary?: string | null
}): { result: Promise<RecentAction>; clearPendingTransaction: ReturnType<typeof vi.fn> } {
  const clearPendingTransaction = vi.fn()
  const fakeThis = {
    executor: { getPendingSummary: () => opts.pendingSummary ?? null, clearPendingTransaction },
    config: { password: 'pw' },
  }
  const result = (AgentSession.prototype as any).runPasswordGatedTool.call(
    fakeThis,
    opts.toolName,
    'tc-1',
    opts.ui,
    opts.body,
    opts.input
  )
  return { result, clearPendingTransaction }
}

describe('runPasswordGatedTool — confirmation gate', () => {
  it('sign_tx declined → CONFIRMATION_REQUIRED, body() never runs, buffer cleared', async () => {
    const ui = makeUi(false)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: {} }) as RecentAction)
    const { result, clearPendingTransaction } = callGate({
      toolName: 'sign_tx',
      ui,
      body,
      pendingSummary: 'send 0.001 ETH on Base to 0xabc',
    })
    const res = await result
    expect(ui.requestConfirmation).toHaveBeenCalledWith('send 0.001 ETH on Base to 0xabc')
    expect(body).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.data?.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    expect(res.data?.proposed).toBe('send 0.001 ETH on Base to 0xabc')
    // The rejected envelope must not linger into later turns.
    expect(clearPendingTransaction).toHaveBeenCalledOnce()
  })

  it('sign_tx approved → confirmation requested exactly once, body() runs', async () => {
    const ui = makeUi(true)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: { tx_hash: '0x1' } }) as RecentAction)
    const { result, clearPendingTransaction } = callGate({
      toolName: 'sign_tx',
      ui,
      body,
      pendingSummary: 'send 1 ETH',
    })
    const res = await result
    // Revert-sensitivity: if the gate is removed, this fails (not just the deny tests).
    expect(ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(body).toHaveBeenCalledOnce()
    expect(res.success).toBe(true)
    expect(res.data?.tx_hash).toBe('0x1')
    expect(clearPendingTransaction).not.toHaveBeenCalled()
  })

  it('sign_typed_data ignores a stale buffered tx summary (declined sign_tx leaves the buffer populated)', async () => {
    const ui = makeUi(false)
    const { result, clearPendingTransaction } = callGate({
      toolName: 'sign_typed_data',
      ui,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: '{"domain":{}}' },
      // Simulates the buffer left behind by a previously DECLINED sign_tx —
      // the typed-data prompt must not present the old send/swap text.
      pendingSummary: 'send 0.001 ETH on Base to 0xabc',
    })
    const res = await result
    const shown = ui.requestConfirmation.mock.calls[0][0]
    expect(shown).toContain('sign_typed_data')
    expect(shown).not.toContain('send 0.001 ETH')
    expect(res.data?.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    // Declining typed-data must NOT clear the (unrelated) tx buffer.
    expect(clearPendingTransaction).not.toHaveBeenCalled()
  })

  it('sign_typed_data with no buffer falls back to tool name + input', async () => {
    const ui = makeUi(false)
    await callGate({
      toolName: 'sign_typed_data',
      ui,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: '{"primaryType":"Permit"}' },
      pendingSummary: null,
    }).result
    expect(ui.requestConfirmation.mock.calls[0][0]).toContain('Permit')
  })

  it('non-signing tools (vault_coin) bypass the gate entirely', async () => {
    const ui = makeUi(false) // would deny if asked
    const body = vi.fn(async () => ({ tool: 'vault_coin', success: true, data: {} }) as RecentAction)
    const res = await callGate({ toolName: 'vault_coin', ui, body, pendingSummary: 'stale tx summary' }).result
    expect(ui.requestConfirmation).not.toHaveBeenCalled()
    expect(body).toHaveBeenCalledOnce()
    expect(res.success).toBe(true)
  })
})

// Integration-shaped wiring test: a tx_ready SSE event must reach the signer
// ONLY through the confirmation gate. This is the test that fails if a
// refactor ever routes tx_ready straight to executor.signTxFromBuffer —
// the unit tests above can't catch that un-wiring.
describe('processMessageLoop — tx_ready wiring through the gate', () => {
  function makeLoopHarness(opts: { approve: boolean }) {
    const signTxFromBuffer = vi.fn(
      async () => ({ tool: 'sign_tx', success: true, data: { tx_hash: '0xfeed', chain: 'Base' } }) as RecentAction
    )
    const clearPendingTransaction = vi.fn()
    const streamRequests: any[] = []
    const client = {
      sendMessageStream: vi.fn(async (_conv: string, request: any, callbacks: any) => {
        streamRequests.push(request)
        // First turn: backend proposes a server-built tx. Later turns: plain text.
        if (streamRequests.length === 1) {
          callbacks.onTxReady({ chain: 'Base', txArgs: { tx: { to: '0xR', value: '1' } } })
        }
        return { message: { content: 'ok' }, fullText: '', transactions: [] }
      }),
    }
    const executor = {
      storeServerTransaction: vi.fn(() => true),
      setPassword: vi.fn(),
      getPendingSummary: () => 'send 1 ETH on Base to 0xR',
      signTxFromBuffer,
      clearPendingTransaction,
    }
    const ui = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSuggestions: vi.fn(),
      onTxStatus: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
      requestPassword: vi.fn(async () => 'pw'),
      requestConfirmation: vi.fn(async () => opts.approve),
    }
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      cachedContext: { addresses: {} },
      config: { password: 'pw', askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      client,
      executor,
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    }
    const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'hello', ui, 0)
    return { run, ui, client, streamRequests, signTxFromBuffer, clearPendingTransaction }
  }

  it('denied: tx_ready never reaches signTxFromBuffer; CONFIRMATION_REQUIRED reported to backend', async () => {
    const h = makeLoopHarness({ approve: false })
    await h.run()
    expect(h.ui.requestConfirmation).toHaveBeenCalledExactlyOnceWith('send 1 ETH on Base to 0xR')
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
    expect(h.clearPendingTransaction).toHaveBeenCalledOnce()
    expect(h.ui.onTxStatus).not.toHaveBeenCalled()
    // The decline is recursed back to the backend as a recent_action.
    expect(h.streamRequests).toHaveLength(2)
    const reported = h.streamRequests[1].context.recent_actions
    expect(reported).toHaveLength(1)
    expect(reported[0].data.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })

  it('approved: signs via the gate and emits tx_status', async () => {
    const h = makeLoopHarness({ approve: true })
    await h.run()
    expect(h.ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(h.signTxFromBuffer).toHaveBeenCalledOnce()
    expect(h.clearPendingTransaction).not.toHaveBeenCalled()
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Base', 'pending', undefined)
    expect(h.streamRequests).toHaveLength(2)
    expect(h.streamRequests[1].context.recent_actions[0].success).toBe(true)
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })
})
