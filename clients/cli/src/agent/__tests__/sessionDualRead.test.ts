// Phase-1 dual-read: the session captures two per-turn signable candidates —
// the backend `tx_ready` (authoritative when signable) and a client-side
// tool-output candidate (parity reference; sign source only when no usable
// tx_ready) — and reconciles them AFTER the stream via `selectAndBufferSignable`.
//
// This exercises: single tool-output candidate → signs once; two in one turn →
// first-wins + reported deferral; both channels → tx_ready authoritative (no
// double-store); unsignable tx_ready + signable tool-output → tool-output
// fallback. Driven through processMessageLoop with a minimal `this`, mirroring
// sessionTxConfirm/sessionConfirmGate.
import { describe, expect, it, vi } from 'vitest'

import { AgentSession } from '../session'
import { buildTxReadyFromToolOutput, payloadLooksSignable, POLYMARKET_SETUP_TRADING_TOOL } from '../toolOutputSigning'
import type { RecentAction } from '../types'

const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const SPENDER = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const ROUTER = '0x1111111111111111111111111111111111111111'
const APPROVE_A = '0x095ea7b3' + '0'.repeat(120)
const APPROVE_B = '0x095ea7b3' + '1'.repeat(120)

/** A frame descriptor: which channel fires, with which payload. */
type Frame =
  | ({ channel: 'tx_ready' } & { payload: unknown })
  | { channel: 'tool_output'; payload: unknown; toolName: string }

function makeHarness(frames: Frame[]) {
  const storeServerTransaction = vi.fn(() => true)
  const signTxFromBuffer = vi.fn(
    async () =>
      ({
        tool: 'sign_tx',
        success: true,
        data: { tx_hash: '0xfeed', chain: 'Polygon', explorer_url: 'https://x/1' },
      }) as RecentAction
  )
  const client = {
    sendMessageStream: vi.fn(async (_conv: string, _request: any, callbacks: any) => {
      if (client.sendMessageStream.mock.calls.length === 1) {
        for (const f of frames) {
          if (f.channel === 'tx_ready') callbacks.onTxReady(f.payload)
          else callbacks.onToolOutputTx(f.payload, f.toolName, 'flat')
        }
      }
      return { message: { content: 'ok' }, fullText: '', transactions: [], disconnected: false }
    }),
  }
  const executor = {
    storeServerTransaction,
    setPassword: vi.fn(),
    getPendingSummary: () => 'contract call on Polygon to 0xR',
    signTxFromBuffer,
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
    onDone: vi.fn(),
    onNotification: vi.fn(),
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
    client,
    executor,
    vault: undefined,
    txConfirmPollIntervalMs: 0,
    txConfirmMaxPolls: 1,
    processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
    runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
    renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    confirmBroadcastedTx: (AgentSession.prototype as any).confirmBroadcastedTx,
    emitAndConfirmTx: (AgentSession.prototype as any).emitAndConfirmTx,
    txConfirmSleep: (AgentSession.prototype as any).txConfirmSleep,
    selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
    logToolOutputParity: (AgentSession.prototype as any).logToolOutputParity,
    reportDeferredSignable: (AgentSession.prototype as any).reportDeferredSignable,
    withAuthRetry: <T>(fn: () => Promise<T>) => fn(),
  }
  const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'deposit $5', ui, 1)
  return { run, storeServerTransaction, signTxFromBuffer, ui }
}

// Derived from the REAL bridge (not hand-written literals) so a shape change in
// buildTxReadyFromToolOutput is exercised on the session path too.
const TX_A = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, {
  chain: 'Polygon',
  chain_id: '137',
  to: USDC_E,
  value: '0',
  data: APPROVE_A,
  action: 'approve',
})
const TX_B = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, {
  chain: 'Polygon',
  chain_id: '137',
  to: SPENDER,
  value: '0',
  data: APPROVE_B,
  action: 'approve',
})

describe('processMessageLoop — dual-read candidate selection', () => {
  it('buffers + signs exactly once for a single tool-output candidate (polymarket, no tx_ready)', async () => {
    const h = makeHarness([{ channel: 'tool_output', payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL }])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).not.toHaveBeenCalled()
  })

  it('keeps the FIRST tool-output candidate, drops + REPORTS the second in one turn', async () => {
    const h = makeHarness([
      { channel: 'tool_output', payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL },
      { channel: 'tool_output', payload: TX_B, toolName: POLYMARKET_SETUP_TRADING_TOOL },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).toHaveBeenCalledTimes(1)
  })

  it('a signable tx_ready is AUTHORITATIVE — the tool-output twin is NOT double-stored (parity-only)', async () => {
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to: USDC_E, value: '0', data: APPROVE_A } }
    expect(payloadLooksSignable(txReady)).toBe(true)
    const h = makeHarness([
      { channel: 'tool_output', payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL },
      { channel: 'tx_ready', payload: txReady },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(txReady)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('falls back to the tool-output candidate when tx_ready is structurally UNSIGNABLE (build_custom_* shape)', async () => {
    // Backend tx_ready for a divergent-field tool wraps to_address/calldata the
    // signer can't read → payloadLooksSignable=false → prefer the normalized
    // tool-output candidate.
    const unsignableTxReady = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to_address: ROUTER, calldata: APPROVE_A, value: '0' },
    }
    expect(payloadLooksSignable(unsignableTxReady)).toBe(false)
    const h = makeHarness([
      { channel: 'tx_ready', payload: unsignableTxReady },
      { channel: 'tool_output', payload: TX_A, toolName: 'build_custom_credit_topup' },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('signs a tx_ready-only turn (no tool-output) — unchanged legacy behavior', async () => {
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to: USDC_E, value: '0', data: APPROVE_A } }
    const h = makeHarness([{ channel: 'tx_ready', payload: txReady }])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(txReady)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })
})
