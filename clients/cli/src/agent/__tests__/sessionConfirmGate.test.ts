// Unit tests for the runPasswordGatedTool confirmation gate (security fix for
// vultisig-sdk#679: agent ask auto-signed any backend-returned envelope).
// The method is private; it's exercised via the prototype with a minimal
// `this` so no real vault / fs / network is touched.
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentExecutor } from '../executor'
import { AgentSession } from '../session'
import type { RecentAction } from '../types'

function makeUi(approve: boolean) {
  return {
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    requestConfirmation: vi.fn(async (_msg: string) => approve),
    requestPassword: vi.fn(async () => 'pw'),
    onProposedTransaction: vi.fn(),
    onSigningRecord: vi.fn(),
  }
}

function callGate(opts: {
  toolName: string
  ui: ReturnType<typeof makeUi>
  body: () => Promise<RecentAction>
  input?: Record<string, unknown>
  pendingSummary?: string | null
  pendingChain?: string | null
}): { result: Promise<RecentAction>; clearPendingTransaction: ReturnType<typeof vi.fn> } {
  const clearPendingTransaction = vi.fn()
  const fakeThis = {
    executor: {
      getPendingSummary: () => opts.pendingSummary ?? null,
      getPendingChain: () => opts.pendingChain ?? null,
      clearPendingTransaction,
    },
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
      pendingChain: 'Base',
    })
    const res = await result
    expect(ui.requestConfirmation).toHaveBeenCalledWith('send 0.001 ETH on Base to 0xabc')
    expect(body).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.data?.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    expect(res.data?.proposed).toBe('send 0.001 ETH on Base to 0xabc')
    expect(res.data?.proposed_chain).toBe('Base')
    // The built transaction is captured BEFORE the buffer is dropped — a declined
    // signing is the one case where the unsigned tx IS the turn's result.
    expect(ui.onProposedTransaction).toHaveBeenCalledExactlyOnceWith({
      tool: 'sign_tx',
      summary: 'send 0.001 ETH on Base to 0xabc',
      chain: 'Base',
    })
    expect(ui.onSigningRecord).not.toHaveBeenCalled()
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

  it('approved token send records the summary derived from the buffered keysign payload', async () => {
    const tokenContract = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
    const recipient = '0x58c4000000000000000000000000000000005c35'
    const keysignPayload = {
      chain: 'Polygon',
      txArgs: {
        chain: 'Polygon',
        to: recipient,
        amount: '50000',
        tx: { to: tokenContract, value: '0', data: '0xa9059cbb' },
      },
      resolved: {
        labels: {
          resolved_amount: '0.05 USDC.e',
          token_resolved: `USDC.e on Polygon (${tokenContract})`,
          recipient_echo: recipient,
        },
      },
    }
    const vault = {
      name: 'mock-vault',
      id: 'vault-mock-1',
      type: 'secure',
      chains: [Chain.Polygon],
      isEncrypted: false,
    } as unknown as VaultBase
    const executor = new AgentExecutor(vault)
    expect(executor.storeServerTransaction(keysignPayload)).toBe(true)
    const ui = makeUi(true)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: {} }) as RecentAction)

    const result = await (AgentSession.prototype as any).runPasswordGatedTool.call(
      { executor, config: { password: 'pw' } },
      'sign_tx',
      'tc-token',
      ui,
      body
    )

    expect(result.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    const record = ui.onSigningRecord.mock.calls[0][0]
    expect(record.tool).toBe('sign_tx')
    expect(record.chain).toBe(keysignPayload.chain)
    expect(record.summary).toContain(keysignPayload.resolved.labels.resolved_amount)
    expect(record.summary).toContain(keysignPayload.txArgs.tx.to)
    expect(record.summary).toContain(keysignPayload.txArgs.to)
  })

  it('approved native send records its buffered keysign payload summary without a token contract', async () => {
    const recipient = '0x58c4000000000000000000000000000000005c35'
    const keysignPayload = {
      chain: 'Polygon',
      txArgs: {
        chain: 'Polygon',
        to: recipient,
        amount: '10000000000000000',
        tx: { to: recipient, value: '10000000000000000', data: '0x' },
      },
      resolved: { labels: { resolved_amount: '0.01 POL', recipient_echo: recipient } },
    }
    const vault = {
      name: 'mock-vault',
      id: 'vault-mock-1',
      type: 'secure',
      chains: [Chain.Polygon],
      isEncrypted: false,
    } as unknown as VaultBase
    const executor = new AgentExecutor(vault)
    expect(executor.storeServerTransaction(keysignPayload)).toBe(true)
    const ui = makeUi(true)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: {} }) as RecentAction)

    const result = await (AgentSession.prototype as any).runPasswordGatedTool.call(
      { executor, config: { password: 'pw' } },
      'sign_tx',
      'tc-native',
      ui,
      body
    )

    expect(result.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    expect(ui.onSigningRecord).toHaveBeenCalledExactlyOnceWith({
      tool: 'sign_tx',
      summary: `send 0.01 POL on Polygon to ${keysignPayload.txArgs.to}`,
      chain: keysignPayload.chain,
    })
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

  it('caps oversized typed-data audit summaries consistently on declined and approved paths', async () => {
    // The sign_typed_data fallback summary is JSON.stringify(input), an arbitrarily large blob that
    // reaches stdout and the JSON envelope. Capping only one of the two representations would ship
    // two conflicting descriptions of the same proposal.
    const ui = makeUi(false)
    const big = 'x'.repeat(2000)
    const { result } = callGate({
      toolName: 'sign_typed_data',
      ui,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: big },
      pendingSummary: null,
    })
    const res = await result
    const proposed = res.data?.proposed as string
    const emitted = ui.onProposedTransaction.mock.calls[0][0].summary
    expect(proposed.length).toBeLessThan(600)
    expect(proposed.endsWith('…')).toBe(true)
    expect(emitted).toBe(proposed)

    const approvedUi = makeUi(true)
    await callGate({
      toolName: 'sign_typed_data',
      ui: approvedUi,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: big },
      pendingSummary: null,
    }).result
    expect(approvedUi.onSigningRecord.mock.calls[0][0].summary).toBe(proposed)
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

// Integration-shaped wiring test: a signable tool-output candidate must reach
// the signer ONLY through the confirmation gate. This is the test that fails if
// a refactor ever routes the tool-output candidate straight to
// executor.signTxFromBuffer — the unit tests above can't catch that un-wiring.
describe('processMessageLoop — tool-output signing wiring through the gate', () => {
  function makeLoopHarness(opts: {
    approve: boolean
    askMode?: boolean
    dispatchDuringTurn?: RecentAction
    extraDispatch?: RecentAction
    noSignable?: boolean
  }) {
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
          // A client-side tool the model dispatched in the SAME response, executed (and queued)
          // before the signable candidate is handled — see processMessageLoop's await of
          // pendingDispatches ahead of the sign gate.
          if (opts.dispatchDuringTurn) callbacks.onClientSideToolCall('tc-dispatch', 'vault_coin', { ticker: 'USDC' })
          if (!opts.noSignable)
            callbacks.onToolOutputTx(
              { chain: 'Base', txArgs: { tx: { to: '0x1111111111111111111111111111111111111111', value: '1' } } },
              'execute_send',
              'prep'
            )
        }
        return { message: { content: 'ok' }, fullText: '', transactions: [] }
      }),
    }
    const executor = {
      storeServerTransaction: vi.fn(() => true),
      setPassword: vi.fn(),
      getPendingSummary: () => 'send 1 ETH on Base to 0xR',
      getPendingChain: () => 'Base',
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
      onProposedTransaction: vi.fn(),
      requestPassword: vi.fn(async () => 'pw'),
      requestConfirmation: vi.fn(async () => opts.approve),
    }
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk-test',
      cachedContext: { addresses: {} },
      config: { password: 'pw', askMode: opts.askMode ?? true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      client,
      executor,
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      reportDeferredSignable: (AgentSession.prototype as any).reportDeferredSignable,
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      // Stubbed: the real dispatcher needs full executor plumbing. What matters here is only that
      // it EXECUTED and queued a result before the sign gate ran, which is the real ordering.
      dispatchClientSideTool: opts.dispatchDuringTurn
        ? async function (this: any) {
            this.pendingToolResults.push(opts.dispatchDuringTurn)
            if (opts.extraDispatch) this.pendingToolResults.push(opts.extraDispatch)
          }
        : (AgentSession.prototype as any).dispatchClientSideTool,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
      renderEchoedYieldOpportunitiesCard: (AgentSession.prototype as any).renderEchoedYieldOpportunitiesCard,
      renderEchoedPolymarketMarketsCard: (AgentSession.prototype as any).renderEchoedPolymarketMarketsCard,
      // No `vault` here, so confirmBroadcastedTx early-returns — the broadcast
      // block still only emits the `pending` status this harness asserts.
      confirmBroadcastedTx: (AgentSession.prototype as any).confirmBroadcastedTx,
      emitAndConfirmTx: (AgentSession.prototype as any).emitAndConfirmTx,
    }
    const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'hello', ui, 0)
    const pendingAfter = () => fakeThis.pendingToolResults
    return { run, ui, client, streamRequests, signTxFromBuffer, clearPendingTransaction, pendingAfter }
  }

  it('denied in ask mode: nothing signs, the turn ENDS, and the proposed transaction is the result', async () => {
    // Ask mode's gate is a fixed policy (no --yes), not a decision the model can
    // influence — so recursing the refusal could only buy a retry that fails again.
    // That retry is what produced the reported defect: execute_send(ok) ->
    // sign_tx(declined) -> execute_send(error), ending in a turn that claimed the
    // build failed / the send tool was missing / a broadcast could not be confirmed,
    // about a transaction that built fine and was never authorized to broadcast.
    const h = makeLoopHarness({ approve: false })
    await h.run()
    expect(h.ui.requestConfirmation).toHaveBeenCalledExactlyOnceWith('send 1 ETH on Base to 0xR')
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
    expect(h.clearPendingTransaction).toHaveBeenCalledOnce()
    expect(h.ui.onTxStatus).not.toHaveBeenCalled()
    // NO second request: the turn ends on the decline instead of retrying into failure.
    expect(h.streamRequests).toHaveLength(1)
    // The built-but-unsigned transaction is surfaced as the turn's result.
    expect(h.ui.onProposedTransaction).toHaveBeenCalledExactlyOnceWith({
      tool: 'sign_tx',
      summary: 'send 1 ETH on Base to 0xR',
      chain: 'Base',
    })
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })

  it('denied in ask mode: an already-executed client-side mutation stays queued (not discarded)', async () => {
    // Client-side dispatches are awaited BEFORE the signable candidate is handled, so a turn can
    // both run a local mutation (vault_chain / vault_coin / address_book) and propose a transaction.
    // Those mutations are committed locally — clearing the whole queue on the decline would silently
    // lose the record of work that actually happened, and the backend would never learn of it.
    const mutation: RecentAction = { tool: 'vault_coin', success: true, data: { added: 'USDC' } }
    const h = makeLoopHarness({ approve: false, dispatchDuringTurn: mutation })
    await h.run()
    expect(h.streamRequests).toHaveLength(1)
    // The declined refusal is dropped (it IS the turn's result); the executed mutation is NOT —
    // it stays queued so the next request still reports it as a recent_action.
    expect(h.pendingAfter()).toEqual([mutation])
  })

  it('denied sign_typed_data in ask mode also ENDS the turn (it reaches the queue by another route)', async () => {
    // sign_typed_data is gated by the SAME confirm gate but is dispatched as a client-side tool, so
    // its refusal lands on the generic pendingToolResults recursion rather than the signable branch.
    // Without the second terminal check, `agent ask "bet 5 USDC on X"` without --yes kept the exact
    // retry-into-failure behavior this change exists to remove.
    const declined: RecentAction = {
      tool: 'sign_typed_data',
      success: false,
      data: {
        error: 'Transaction not confirmed',
        code: AgentErrorCode.CONFIRMATION_REQUIRED,
        proposed: 'sign_typed_data {"primaryType":"Order"}',
      },
    }
    const h = makeLoopHarness({ approve: false, dispatchDuringTurn: declined, noSignable: true })
    await h.run()
    expect(h.streamRequests).toHaveLength(1)
    expect(h.pendingAfter()).toEqual([])
    expect(h.ui.onDone).toHaveBeenCalledOnce()
  })

  it('denied sign_typed_data OUTSIDE ask mode still recurses', async () => {
    const declined: RecentAction = {
      tool: 'sign_typed_data',
      success: false,
      data: { error: 'Transaction not confirmed', code: AgentErrorCode.CONFIRMATION_REQUIRED },
    }
    const h = makeLoopHarness({ approve: false, askMode: false, dispatchDuringTurn: declined, noSignable: true })
    await h.run()
    expect(h.streamRequests).toHaveLength(2)
  })

  it('EVERY queued decline is dropped — two typed-data declines in one turn leak none', async () => {
    // Client-side dispatches are serialized and all awaited before the turn ends, so one response
    // can queue several declined sign_typed_data calls. Removing only the first would leave the rest
    // queued, and the NEXT request would flush a stale refusal into an unrelated turn.
    const decline = (id: string): RecentAction => ({
      tool: 'sign_typed_data',
      success: false,
      data: { error: 'Transaction not confirmed', code: AgentErrorCode.CONFIRMATION_REQUIRED, proposed: id },
    })
    const h = makeLoopHarness({
      approve: false,
      dispatchDuringTurn: decline('first'),
      extraDispatch: decline('second'),
      noSignable: true,
    })
    await h.run()
    expect(h.streamRequests).toHaveLength(1)
    expect(h.pendingAfter()).toEqual([])
  })

  it('a typed-data decline queued alongside a declined sign_tx does not leak either', async () => {
    // The signable branch returns WITHOUT reaching the tail check, so it must purge the queue too.
    const typedDecline: RecentAction = {
      tool: 'sign_typed_data',
      success: false,
      data: { error: 'Transaction not confirmed', code: AgentErrorCode.CONFIRMATION_REQUIRED },
    }
    const mutation: RecentAction = { tool: 'vault_coin', success: true, data: { added: 'USDC' } }
    const h = makeLoopHarness({ approve: false, dispatchDuringTurn: typedDecline, extraDispatch: mutation })
    await h.run()
    expect(h.streamRequests).toHaveLength(1)
    // Both refusals gone; the executed mutation survives.
    expect(h.pendingAfter()).toEqual([mutation])
  })

  it('denied OUTSIDE ask mode: the decline is still reported back so the model can acknowledge it', async () => {
    // In the TUI a decline is a live user choice mid-conversation, and in pipe mode
    // the host can approve on a later turn — both keep the report-and-continue
    // behavior. The short-circuit is scoped to the non-interactive ask path only.
    const h = makeLoopHarness({ approve: false, askMode: false })
    await h.run()
    expect(h.ui.requestConfirmation).toHaveBeenCalledExactlyOnceWith('send 1 ETH on Base to 0xR')
    expect(h.signTxFromBuffer).not.toHaveBeenCalled()
    // The rejected envelope must not linger into later turns (the original hazard).
    expect(h.clearPendingTransaction).toHaveBeenCalledOnce()
    expect(h.ui.onTxStatus).not.toHaveBeenCalled()
    expect(h.streamRequests).toHaveLength(2)
    const reported = h.streamRequests[1].context.recent_actions
    expect(reported).toHaveLength(1)
    expect(reported[0].data.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    // The proposed transaction is surfaced on every client, not just ask mode.
    expect(h.ui.onProposedTransaction).toHaveBeenCalledOnce()
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

// Balance-card rendering through processMessageLoop. Exercises the typed SSE
// path, the legacy verbatim-echo fallback, and the both-paths-fire case the
// `balanceCardRendered` guard / renderEchoedBalanceCard helper exists for.
describe('processMessageLoop — balance_summary card rendering', () => {
  const ENVELOPE = {
    surface: 'balance_summary',
    accounts: [
      { chainId: 'Ethereum', address: '0xabc', tokens: [{ symbol: 'ETH', amountDecimal: '1.0', amountUsd: '$3,000' }] },
    ],
  }

  function makeCardHarness(opts: { fireSse: boolean; content: string }) {
    const streamRequests: any[] = []
    const client = {
      sendMessageStream: vi.fn(async (_conv: string, request: any, callbacks: any) => {
        streamRequests.push(request)
        if (opts.fireSse) callbacks.onBalanceSummary(ENVELOPE)
        return { message: { content: opts.content }, fullText: '', transactions: [] }
      }),
    }
    const ui = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onBalanceSummary: vi.fn(),
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
      executor: { storeServerTransaction: vi.fn(() => false), setPassword: vi.fn() },
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      reportDeferredSignable: (AgentSession.prototype as any).reportDeferredSignable,
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
      renderEchoedYieldOpportunitiesCard: (AgentSession.prototype as any).renderEchoedYieldOpportunitiesCard,
      renderEchoedPolymarketMarketsCard: (AgentSession.prototype as any).renderEchoedPolymarketMarketsCard,
    }
    const run = () => (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'balances?', ui, 0)
    return { run, ui, streamRequests }
  }

  it('advertises supported_surfaces on every request', async () => {
    const h = makeCardHarness({ fireSse: true, content: 'Your ETH balance is 1.0.' })
    await h.run()
    expect(h.streamRequests[0].supported_surfaces).toContain('balance_summary')
  })

  it('typed SSE path: renders the card once and shows the narration prose', async () => {
    const h = makeCardHarness({ fireSse: true, content: 'You hold 1 ETH (~$3,000).' })
    await h.run()
    expect(h.ui.onBalanceSummary).toHaveBeenCalledOnce()
    expect(h.ui.onAssistantMessage).toHaveBeenCalledWith('You hold 1 ETH (~$3,000).')
  })

  it('both paths fire: card renders once (SSE) and the echoed JSON is stripped from the text', async () => {
    // Misbehaving/transitional backend: emits the typed SSE part AND lets the
    // model echo the envelope JSON into message content. The card must render
    // exactly once and the raw JSON must never reach onAssistantMessage.
    const content = `Here you go: ${JSON.stringify(ENVELOPE)} all set.`
    const h = makeCardHarness({ fireSse: true, content })
    await h.run()
    expect(h.ui.onBalanceSummary).toHaveBeenCalledOnce()
    const shown = h.ui.onAssistantMessage.mock.calls[0]?.[0] ?? ''
    expect(shown).not.toContain('"surface"')
    expect(shown).toContain('Here you go:')
    expect(shown).toContain('all set.')
  })

  it('legacy-only fallback: echoed JSON with no SSE part still renders the card and strips the JSON', async () => {
    const content = JSON.stringify(ENVELOPE)
    const h = makeCardHarness({ fireSse: false, content })
    await h.run()
    expect(h.ui.onBalanceSummary).toHaveBeenCalledOnce()
    // The message was nothing but the envelope → no empty assistant message.
    expect(h.ui.onAssistantMessage).not.toHaveBeenCalled()
  })
})
