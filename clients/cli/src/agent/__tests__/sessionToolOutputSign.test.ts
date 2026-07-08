// #927 Phase 2: the client-enriched candidate off the `tool-output-available`
// channel is the SOLE signing source. The session captures one candidate per
// turn (first-wins) and buffers it into the executor via `selectAndBufferSignable`
// after the stream — no `tx_ready`, no parity cross-check.
//
// This exercises: single candidate → signs once; two in one turn → first-wins +
// reported deferral; a PREP (execute_*) candidate signs from tool-output (the
// Phase-1 "prep never signs" rule INVERTS); and the fail-closed sign gate — a
// structurally-unsignable candidate is NEVER routed to the signer, even when the
// executor store would accept it (the `payloadLooksSignable` mutation target).
// Driven through processMessageLoop with a minimal `this`, mirroring
// sessionTxConfirm/sessionConfirmGate.
import { describe, expect, it, vi } from 'vitest'

import { AgentSession } from '../session'
import { buildTxReadyFromToolOutput, payloadLooksSignable, POLYMARKET_SETUP_TRADING_TOOL } from '../toolOutputSigning'
import type { RecentAction } from '../types'

const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const SPENDER = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const APPROVE_A = '0x095ea7b3' + '0'.repeat(120)
const APPROVE_B = '0x095ea7b3' + '1'.repeat(120)

/** A frame descriptor: a tool-output candidate on the sole signing channel. */
type Frame = { payload: unknown; toolName: string; source?: 'flat' | 'prep' }

function makeHarness(frames: Frame[], storeImpl: (payload: any) => boolean = () => true) {
  const storeServerTransaction = vi.fn(storeImpl)
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
          callbacks.onToolOutputTx(f.payload, f.toolName, f.source ?? 'flat')
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

// A realistic execute_send PREP envelope (the exact shape agent-backend-ts emits
// on tool-output-available — golden comma-send.json).
const PREP_SEND = {
  txArgs: {
    chain: 'Base',
    chain_id: '8453',
    tx_encoding: 'evm',
    tx: { to: USDC_E, value: '0', data: APPROVE_A },
  },
  stepperConfig: {},
}

describe('processMessageLoop — tool-output is the sole sign source', () => {
  it('buffers + signs exactly once for a single flat tool-output candidate (polymarket)', async () => {
    const h = makeHarness([{ payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL }])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).not.toHaveBeenCalled()
  })

  it('signs a PREP candidate (execute_send) from tool-output — Phase-1 "prep never signs" INVERTS', async () => {
    // In Phase 1, execute_* prep was parity-only and tx_ready signed it. Phase 2
    // removes tx_ready, so the prep tool-output candidate is the sign source
    // (production emits the payload here; data-tx_ready is a hollow marker).
    expect(payloadLooksSignable(PREP_SEND)).toBe(true)
    const h = makeHarness([{ payload: PREP_SEND, toolName: 'execute_send', source: 'prep' }])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(PREP_SEND)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('keeps the FIRST candidate, drops + REPORTS the second in one turn', async () => {
    const h = makeHarness([
      { payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL },
      { payload: TX_B, toolName: POLYMARKET_SETUP_TRADING_TOOL },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    // The deferred second candidate is REPORTED (never silently dropped).
    expect(h.ui.onNotification).toHaveBeenCalledTimes(1)
  })

  it('FAILS CLOSED: a structurally-unsignable candidate is NEVER signed, even when the store would accept it', async () => {
    // The mutation-check for the sign gate: `payloadLooksSignable` is the
    // load-bearing structural check. With a permissive store mock (returns true),
    // the ONLY thing that prevents signing an unsignable payload is this gate — so
    // deleting it makes storeServerTransaction fire and a bogus tx sign. Here the
    // candidate's `tx.to` is not a real address → not structurally signable → the
    // executor is never touched.
    const unsignable = { chain: 'Polygon', tx: { to: 'not-an-address', value: '0', data: APPROVE_A } }
    expect(payloadLooksSignable(unsignable)).toBe(false)
    const h = makeHarness(
      [{ payload: unsignable, toolName: POLYMARKET_SETUP_TRADING_TOOL }],
      () => true // permissive store — isolates payloadLooksSignable as the sole gate
    )
    await h.run()
    expect(h.storeServerTransaction).not.toHaveBeenCalled()
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
  })

  it('does not sign when there is no signable tool-output candidate at all (plain text turn)', async () => {
    const h = makeHarness([])
    await h.run()
    expect(h.storeServerTransaction).not.toHaveBeenCalled()
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
    expect(h.ui.onDone).toHaveBeenCalled()
  })

  it('store backstop: a signable-looking candidate the executor rejects (store returns false) does not sign', async () => {
    // payloadLooksSignable passes but the executor store returns false (e.g. an
    // inconsistent multi-leg the store rejects) — the final backstop keeps it
    // fail-closed: no sign, a false is never a wrong sign.
    const h = makeHarness([{ payload: TX_A, toolName: POLYMARKET_SETUP_TRADING_TOOL }], () => false)
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
  })
})
