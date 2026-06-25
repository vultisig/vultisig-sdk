// Unit tests for post-broadcast confirmation polling (audit F1).
//
// After a tx_ready tx is signed + broadcast the session must not stop at
// `pending` (broadcast accepted) — it polls vault.getTxStatus until the tx
// reaches a final on-chain state and emits the matching lifecycle status so a
// headless caller learns confirmed/failed/timeout. Exercised through
// processMessageLoop with a minimal `this`, mirroring sessionConfirmGate.
import { describe, expect, it, vi } from 'vitest'

import { AgentSession } from '../session'
import type { RecentAction } from '../types'

type StatusResult = { status: 'pending' | 'success' | 'error' }

function makeHarness(opts: {
  // Sequence of getTxStatus outcomes; a function entry throws to simulate a
  // transient RPC error. The last entry repeats once exhausted.
  statuses: Array<StatusResult | 'throw'>
  maxPolls?: number
  includeVault?: boolean
  // Defaults to headless (askMode). Set false to model the interactive TUI,
  // where confirmation polling must be skipped.
  headless?: boolean
  // When true the abort controller is already aborted before polling starts.
  aborted?: boolean
  // Message-loop depth to start at. Depth 0 models a fresh ask/pipe turn;
  // depth > 0 models a tx_ready arriving inside a multi-turn tool loop.
  startDepth?: number
}) {
  const signTxFromBuffer = vi.fn(
    async () =>
      ({
        tool: 'sign_tx',
        success: true,
        data: { tx_hash: '0xfeed', chain: 'Base', explorer_url: 'https://x/1' },
      }) as RecentAction
  )
  const client = {
    sendMessageStream: vi.fn(async (_conv: string, _request: any, callbacks: any) => {
      // Fire a server-built tx on the first turn only; later turns are plain text.
      if (client.sendMessageStream.mock.calls.length === 1) {
        callbacks.onTxReady({
          chain: 'Base',
          txArgs: { tx: { to: '0xR', value: '1' } },
        })
      }
      return { message: { content: 'ok' }, fullText: '', transactions: [] }
    }),
  }
  const executor = {
    storeServerTransaction: vi.fn(() => true),
    setPassword: vi.fn(),
    getPendingSummary: () => 'send 1 ETH on Base to 0xR',
    signTxFromBuffer,
    clearPendingTransaction: vi.fn(),
  }
  let call = 0
  const getTxStatus = vi.fn(async (_args: { chain: unknown; txHash: string }) => {
    const entry = opts.statuses[Math.min(call, opts.statuses.length - 1)]
    call++
    if (entry === 'throw') throw new Error('rpc unavailable')
    return entry
  })
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
    requestConfirmation: vi.fn(async () => true),
  }
  const fakeThis: any = {
    conversationId: 'conv-1',
    publicKey: 'pk-test',
    cachedContext: { addresses: {} },
    config: { password: 'pw', askMode: opts.headless !== false, verbose: false },
    pendingToolResults: [],
    abortController: opts.aborted ? { signal: { aborted: true } } : null,
    client,
    executor,
    vault: opts.includeVault === false ? undefined : { getTxStatus },
    // No real waits between polls.
    txConfirmPollIntervalMs: 0,
    txConfirmMaxPolls: opts.maxPolls ?? 5,
    processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
    runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
    renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    confirmBroadcastedTx: (AgentSession.prototype as any).confirmBroadcastedTx,
    emitAndConfirmTx: (AgentSession.prototype as any).emitAndConfirmTx,
    txConfirmSleep: (AgentSession.prototype as any).txConfirmSleep,
  }
  const run = () =>
    (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'send 1 ETH', ui, opts.startDepth ?? 0)
  return { run, ui, getTxStatus }
}

describe('processMessageLoop — post-broadcast confirmation (F1)', () => {
  it('emits pending then confirmed when the tx reaches success', async () => {
    const h = makeHarness({
      statuses: [{ status: 'pending' }, { status: 'success' }],
    })
    await h.run()
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(1, '0xfeed', 'Base', 'pending', 'https://x/1')
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(2, '0xfeed', 'Base', 'confirmed', 'https://x/1')
    expect(h.ui.onTxStatus).toHaveBeenCalledTimes(2)
  })

  it('emits failed when the tx reverts (status error)', async () => {
    const h = makeHarness({ statuses: [{ status: 'error' }] })
    await h.run()
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(1, '0xfeed', 'Base', 'pending', 'https://x/1')
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(2, '0xfeed', 'Base', 'failed', 'https://x/1')
  })

  it('keeps polling through transient RPC errors before confirming', async () => {
    const h = makeHarness({
      statuses: ['throw', { status: 'pending' }, { status: 'success' }],
    })
    await h.run()
    expect(h.getTxStatus).toHaveBeenCalledTimes(3)
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(2, '0xfeed', 'Base', 'confirmed', 'https://x/1')
  })

  it('emits timeout when the budget is exhausted without a final state', async () => {
    const h = makeHarness({ statuses: [{ status: 'pending' }], maxPolls: 3 })
    await h.run()
    expect(h.getTxStatus).toHaveBeenCalledTimes(3)
    expect(h.ui.onTxStatus).toHaveBeenNthCalledWith(2, '0xfeed', 'Base', 'timeout', 'https://x/1')
  })

  it('falls back to pending-only when the vault cannot poll status', async () => {
    const h = makeHarness({
      statuses: [{ status: 'success' }],
      includeVault: false,
    })
    await h.run()
    expect(h.ui.onTxStatus).toHaveBeenCalledTimes(1)
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Base', 'pending', 'https://x/1')
  })

  it('does not poll in interactive (non-headless) mode — only pending is emitted', async () => {
    const h = makeHarness({ statuses: [{ status: 'success' }], headless: false })
    await h.run()
    expect(h.getTxStatus).not.toHaveBeenCalled()
    expect(h.ui.onTxStatus).toHaveBeenCalledTimes(1)
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Base', 'pending', 'https://x/1')
  })

  it('skips the blocking poll inside a multi-turn tool loop (depth > 0)', async () => {
    // A tx_ready signed at depth > 0 (inside an ongoing tool loop) must NOT
    // block the recursion on confirmation: the broadcast result is already
    // queued to drive the server's next turn, and the confirmation status is
    // never fed back to the server, so blocking would only stack the full poll
    // budget per leg (a latency cliff for batched txs). The leg keeps its
    // honest `pending`; no getTxStatus poll runs. (Depth 0 — the common
    // single-tx ask/pipe case — still polls; see the tests above.)
    const h = makeHarness({ statuses: [{ status: 'success' }], startDepth: 1 })
    await h.run()
    expect(h.getTxStatus).not.toHaveBeenCalled()
    expect(h.ui.onTxStatus).toHaveBeenCalledTimes(1)
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Base', 'pending', 'https://x/1')
  })

  it('bails immediately when the operation was aborted (Ctrl-C)', async () => {
    const h = makeHarness({ statuses: [{ status: 'pending' }], aborted: true })
    await h.run()
    expect(h.getTxStatus).not.toHaveBeenCalled()
    // Only the pre-poll `pending` was emitted; no confirmed/failed/timeout.
    expect(h.ui.onTxStatus).toHaveBeenCalledTimes(1)
    expect(h.ui.onTxStatus).toHaveBeenCalledWith('0xfeed', 'Base', 'pending', 'https://x/1')
  })
})
