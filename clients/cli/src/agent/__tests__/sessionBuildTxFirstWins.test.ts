// C1 regression: first-wins enforcement for signable tx_ready frames in a turn.
//
// The executor buffers a single 'latest' slot and signs it once after the
// stream. The Design B build-tx bridge can surface a SECOND signable frame in
// one turn (if the model chains two flat-builder calls). Without a guard the
// second would overwrite the first and silently leave it unsigned. The session's
// onTxReady must keep the FIRST and drop the rest — never a partial/wrong sign.
//
// Driven through processMessageLoop with a minimal `this`, mirroring
// sessionTxConfirm/sessionConfirmGate.
import { describe, expect, it, vi } from 'vitest'

import { buildTxReadyFromToolOutput, POLYMARKET_SETUP_TRADING_TOOL } from '../polymarketTxOutput'
import { AgentSession } from '../session'
import type { RecentAction } from '../types'

function makeHarness(txReadyPayloads: unknown[]) {
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
      // Fire all payloads on the first turn only; later turns are plain text.
      if (client.sendMessageStream.mock.calls.length === 1) {
        for (const p of txReadyPayloads) callbacks.onTxReady(p)
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
    withAuthRetry: <T>(fn: () => Promise<T>) => fn(),
  }
  const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'deposit $5', ui, 1)
  return { run, storeServerTransaction, signTxFromBuffer }
}

// Derived from the REAL bridge (not hand-written literals) so a shape change in
// buildTxReadyFromToolOutput is exercised on the session's onTxReady path too.
const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const SPENDER = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const TX_A = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, {
  chain: 'Polygon',
  chain_id: '137',
  to: USDC_E,
  value: '0',
  data: '0x095ea7b3' + '0'.repeat(120),
  action: 'approve',
})
const TX_B = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, {
  chain: 'Polygon',
  chain_id: '137',
  to: SPENDER,
  value: '0',
  data: '0x095ea7b3' + '1'.repeat(120),
  action: 'approve',
})

describe('processMessageLoop — first-wins for signable tx_ready (C1)', () => {
  it('buffers + signs exactly once when a single tx_ready arrives', async () => {
    const h = makeHarness([TX_A])
    await h.run()
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })

  it('keeps the FIRST and drops the second when two tx_ready arrive in one turn', async () => {
    const h = makeHarness([TX_A, TX_B])
    await h.run()
    // second frame never reaches the executor — no silent overwrite
    expect(h.storeServerTransaction).toHaveBeenCalledTimes(1)
    expect(h.storeServerTransaction).toHaveBeenCalledWith(TX_A)
    expect(h.signTxFromBuffer).toHaveBeenCalledTimes(1)
  })
})
