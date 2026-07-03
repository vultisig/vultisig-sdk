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

/**
 * A frame descriptor: which channel fires, with which payload. `callId` carries
 * the tool-call id used to PAIR the two channels: on `tool_output` it is the
 * frame's own id; on `tx_ready` it is the id of the tool-output frame this
 * tx_ready is the wire-adjacent twin of (client.ts derives it). Matching ids →
 * same tool call (diff runs); differing ids → unrelated (diff skipped).
 */
type Frame =
  | { channel: 'tx_ready'; payload: unknown; callId?: string }
  | {
      channel: 'tool_output'
      payload: unknown
      toolName: string
      source?: 'flat' | 'prep'
      callId?: string
    }

function makeHarness(frames: Frame[], storeImpl: (payload: any) => boolean = () => true) {
  const storeServerTransaction = vi.fn(storeImpl)
  const signTxFromBuffer = vi.fn(
    async () =>
      ({
        tool: 'sign_tx',
        success: true,
        data: {
          tx_hash: '0xfeed',
          chain: 'Polygon',
          explorer_url: 'https://x/1',
        },
      }) as RecentAction
  )
  const client = {
    sendMessageStream: vi.fn(async (_conv: string, _request: any, callbacks: any) => {
      if (client.sendMessageStream.mock.calls.length === 1) {
        for (const f of frames) {
          if (f.channel === 'tx_ready') callbacks.onTxReady(f.payload, f.callId)
          else callbacks.onToolOutputTx(f.payload, f.toolName, f.source ?? 'flat', f.callId)
        }
      }
      return {
        message: { content: 'ok' },
        fullText: '',
        transactions: [],
        disconnected: false,
      }
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
    const h = makeHarness([
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: POLYMARKET_SETUP_TRADING_TOOL,
      },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).not.toHaveBeenCalled()
  })

  it('keeps the FIRST tool-output candidate, drops + REPORTS the second in one turn', async () => {
    const h = makeHarness([
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: POLYMARKET_SETUP_TRADING_TOOL,
      },
      {
        channel: 'tool_output',
        payload: TX_B,
        toolName: POLYMARKET_SETUP_TRADING_TOOL,
      },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).toHaveBeenCalledTimes(1)
  })

  it('keeps the FIRST tx_ready frame, drops + REPORTS the second in one turn (symmetric to tool-output first-wins)', async () => {
    // The onTxReady callback is first-wins with a reported deferral, exactly like
    // onToolOutputTx: two data-tx_ready frames in ONE stream turn must buffer the
    // FIRST and defer (never overwrite/double-sign) the second. This guards the
    // session.ts onTxReady branch (`txReadyCandidate !== null → reportDeferredSignable`).
    const txReadyA = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: USDC_E, value: '0', data: APPROVE_A },
    }
    const txReadyB = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: SPENDER, value: '0', data: APPROVE_B },
    }
    const h = makeHarness([
      { channel: 'tx_ready', payload: txReadyA },
      { channel: 'tx_ready', payload: txReadyB },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(txReadyA)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.ui.onNotification).toHaveBeenCalledTimes(1)
  })

  it('a signable tx_ready is AUTHORITATIVE — the tool-output twin is NOT double-stored (parity-only)', async () => {
    const txReady = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: USDC_E, value: '0', data: APPROVE_A },
    }
    expect(payloadLooksSignable(txReady)).toBe(true)
    const h = makeHarness([
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: POLYMARKET_SETUP_TRADING_TOOL,
      },
      { channel: 'tx_ready', payload: txReady },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(txReady)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    // A parity TWIN (same tx on both channels) is dropped SILENTLY — no deferral.
    expect(h.ui.onNotification).not.toHaveBeenCalled()
  })

  it('signs the tx_ready but DEFERS (never silently drops) a DISTINCT flat tool-output candidate in the same turn', async () => {
    // Cross-channel first-wins gap (round-2 Codex+correctness convergence): a flat
    // tool-output-only signable (polymarket) arrives in the SAME turn as an
    // UNRELATED signable tx_ready. Only one payload signs per turn — the tx_ready
    // is authoritative — but the DISTINCT flat candidate must be REPORTED as
    // deferred, never silently dropped (a user-requested fund action must not vanish).
    const unrelatedTxReady = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: ROUTER, value: '0', data: APPROVE_B },
    }
    expect(payloadLooksSignable(unrelatedTxReady)).toBe(true)
    const h = makeHarness([
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: POLYMARKET_SETUP_TRADING_TOOL,
      },
      { channel: 'tx_ready', payload: unrelatedTxReady },
    ])
    await h.run()
    // tx_ready (authoritative) signs.
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(unrelatedTxReady)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    // …and the distinct flat candidate is DEFERRED (not silently dropped).
    expect(h.ui.onNotification).toHaveBeenCalledTimes(1)
  })

  it('falls back to the tool-output candidate when its TWIN tx_ready is structurally UNSIGNABLE and parity MATCHED (build_custom_* shape)', async () => {
    // Backend tx_ready for a divergent-field tool wraps to_address/calldata the
    // signer can't read → payloadLooksSignable=false. When the normalized
    // tool-output candidate MATCHES that tx_ready on parity (same to/data after
    // to_address→to, calldata→data), the client candidate is proven equivalent
    // and is the safe sign source. The twin tx_ready here canonicalizes to the
    // SAME leg as TX_A (to=USDC_E, data=APPROVE_A), so parity matches.
    const unsignableTxReadyTwin = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to_address: USDC_E, calldata: APPROVE_A, value: '0' },
    }
    expect(payloadLooksSignable(unsignableTxReadyTwin)).toBe(false)
    const h = makeHarness([
      { channel: 'tx_ready', payload: unsignableTxReadyTwin, callId: 'call-1' },
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: 'build_custom_credit_topup',
        callId: 'call-1',
      },
    ])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('FAILS CLOSED: paired flat candidate that DIVERGES from an unsignable twin tx_ready is NEVER signed (review: gomesalexandre)', async () => {
    // The exact risky path the PR adds for build_custom_*: unsignable tx_ready +
    // signable flat tool-output fallback. If the flat candidate DIVERGES from its
    // paired tx_ready (a backend-enrichment change or a client port bug), signing
    // the client-enriched bytes would be a sign-the-wrong-bytes event. It must
    // fail closed to the tx_ready path instead — the flat candidate is NEVER the
    // buffered sign source. Same tool call (callId) → parity runs → diverges.
    //
    // Divergent twin: same tool call, but the tx_ready's `to` (ROUTER) disagrees
    // with the flat candidate's `to` (TX_A → USDC_E). Store mock reflects the REAL
    // executor: an unsignable payload does not resolve to a signable buffer, so
    // NOTHING signs (fail-closed observable).
    const divergentUnsignableTwin = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to_address: ROUTER, calldata: APPROVE_A, value: '0' },
    }
    expect(payloadLooksSignable(divergentUnsignableTwin)).toBe(false)
    const h = makeHarness(
      [
        {
          channel: 'tx_ready',
          payload: divergentUnsignableTwin,
          callId: 'call-1',
        },
        {
          channel: 'tool_output',
          payload: TX_A,
          toolName: 'build_custom_credit_topup',
          callId: 'call-1',
        },
      ],
      // Faithful store: only a signable payload buffers; the unsignable tx_ready
      // does not → the fail-closed path signs nothing.
      (payload: any) => payloadLooksSignable(payload)
    )
    await h.run()
    // The client-enriched flat candidate (TX_A) is NEVER buffered as a sign source.
    expect(h.storeServerTransaction).not.toHaveBeenCalledWith(TX_A)
    // Nothing signable came out of the tool-output channel → no sign happened.
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
  })

  it('does NOT sign the flat candidate when its diverging twin tx_ready is unsignable, even under the default (buffering) store', async () => {
    // Same fail-closed contract, but with the permissive store mock the REAL
    // executor uses for a structurally-present-but-unsignable tx_ready (it
    // buffers, then throws at sign time). The load-bearing assertion is identical:
    // the flat candidate (TX_A) is never routed to the signer — the tx_ready
    // (unsignable) is the only thing buffered, i.e. we fell closed to the tx_ready
    // path (a hard error at sign time), not to the client-enriched candidate.
    const divergentUnsignableTwin = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to_address: ROUTER, calldata: APPROVE_A, value: '0' },
    }
    const h = makeHarness([
      {
        channel: 'tx_ready',
        payload: divergentUnsignableTwin,
        callId: 'call-1',
      },
      {
        channel: 'tool_output',
        payload: TX_A,
        toolName: 'build_custom_credit_topup',
        callId: 'call-1',
      },
    ])
    await h.run()
    expect(h.storeServerTransaction).not.toHaveBeenCalledWith(TX_A)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(divergentUnsignableTwin)
  })

  it('UNRELATED same-turn pair (different tool calls) produces NO divergence telemetry and does not gate the flat (review: gomesalexandre)', async () => {
    // Pairing telemetry LOW: a flat tool-output (polymarket, its OWN action, no
    // tx_ready) arrives in the same turn as an UNRELATED, structurally divergent
    // tx_ready from a different tool call. Without pairing, diffing them would emit
    // a loud false [DIVERGENCE]. With pairing (different callIds → definitely
    // unpaired), the diff is SKIPPED — no divergence telemetry — and the flat is a
    // valid independent sign source (its twin tx_ready is unsignable/unrelated).
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const unrelatedUnsignable = {
        chain: 'Polygon',
        chain_id: '137',
        tx: { to_address: ROUTER, calldata: APPROVE_B, value: '0' },
      }
      const h = makeHarness([
        {
          channel: 'tool_output',
          payload: TX_A,
          toolName: POLYMARKET_SETUP_TRADING_TOOL,
          callId: 'call-flat',
        },
        {
          channel: 'tx_ready',
          payload: unrelatedUnsignable,
          callId: 'call-other',
        },
      ])
      await h.run()
      // No false divergence telemetry for an unrelated pair.
      const wroteDivergence = stderrSpy.mock.calls.some(c => String(c[0]).includes('[DIVERGENCE]'))
      expect(wroteDivergence).toBe(false)
      // The flat candidate is its own independent, guarded action → it signs;
      // the unrelated unsignable tx_ready never pre-empts it.
      expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
      expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it('signs a tx_ready-only turn (no tool-output) — unchanged legacy behavior', async () => {
    const txReady = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: USDC_E, value: '0', data: APPROVE_A },
    }
    const h = makeHarness([{ channel: 'tx_ready', payload: txReady }])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(txReady)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('NEVER signs a PREP candidate, even with no tx_ready (prep is parity-only — phantom-card safety)', async () => {
    // A source:'prep' tool-output candidate with no tx_ready twin (e.g. the
    // backend suppressed tx_ready for a phantom-card execute_* envelope) must NOT
    // be buffered/signed — selectAndBufferSignable only signs source:'flat'.
    const prep = {
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx: { to: USDC_E, value: '0', data: APPROVE_A },
      },
    }
    const h = makeHarness([
      {
        channel: 'tool_output',
        payload: prep,
        toolName: 'execute_send',
        source: 'prep',
      },
    ])
    await h.run()
    expect(h.storeServerTransaction).not.toHaveBeenCalled()
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
  })
})
