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
}): Promise<RecentAction> {
  const fakeThis = {
    executor: { getPendingSummary: () => opts.pendingSummary ?? null },
    config: { password: 'pw' },
  }
  return (AgentSession.prototype as any).runPasswordGatedTool.call(
    fakeThis,
    opts.toolName,
    'tc-1',
    opts.ui,
    opts.body,
    opts.input
  )
}

describe('runPasswordGatedTool — confirmation gate', () => {
  it('sign_tx declined → CONFIRMATION_REQUIRED, body() never runs', async () => {
    const ui = makeUi(false)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: {} }) as RecentAction)
    const res = await callGate({
      toolName: 'sign_tx',
      ui,
      body,
      pendingSummary: 'send 0.001 ETH on Base to 0xabc',
    })
    expect(ui.requestConfirmation).toHaveBeenCalledWith('send 0.001 ETH on Base to 0xabc')
    expect(body).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.data?.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
    expect(res.data?.proposed).toBe('send 0.001 ETH on Base to 0xabc')
  })

  it('sign_tx approved → body() runs and its result is returned', async () => {
    const ui = makeUi(true)
    const body = vi.fn(async () => ({ tool: 'sign_tx', success: true, data: { tx_hash: '0x1' } }) as RecentAction)
    const res = await callGate({ toolName: 'sign_tx', ui, body, pendingSummary: 'send 1 ETH' })
    expect(body).toHaveBeenCalledOnce()
    expect(res.success).toBe(true)
    expect(res.data?.tx_hash).toBe('0x1')
  })

  it('sign_typed_data ignores a stale buffered tx summary (declined sign_tx leaves the buffer populated)', async () => {
    const ui = makeUi(false)
    const res = await callGate({
      toolName: 'sign_typed_data',
      ui,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: '{"domain":{}}' },
      // Simulates the buffer left behind by a previously DECLINED sign_tx —
      // the typed-data prompt must not present the old send/swap text.
      pendingSummary: 'send 0.001 ETH on Base to 0xabc',
    })
    const shown = ui.requestConfirmation.mock.calls[0][0]
    expect(shown).toContain('sign_typed_data')
    expect(shown).not.toContain('send 0.001 ETH')
    expect(res.data?.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
  })

  it('sign_typed_data with no buffer falls back to tool name + input', async () => {
    const ui = makeUi(false)
    await callGate({
      toolName: 'sign_typed_data',
      ui,
      body: vi.fn(async () => ({ tool: 'sign_typed_data', success: true, data: {} }) as RecentAction),
      input: { typed_data: '{"primaryType":"Permit"}' },
      pendingSummary: null,
    })
    expect(ui.requestConfirmation.mock.calls[0][0]).toContain('Permit')
  })

  it('non-signing tools (vault_coin) bypass the gate entirely', async () => {
    const ui = makeUi(false) // would deny if asked
    const body = vi.fn(async () => ({ tool: 'vault_coin', success: true, data: {} }) as RecentAction)
    const res = await callGate({ toolName: 'vault_coin', ui, body, pendingSummary: 'stale tx summary' })
    expect(ui.requestConfirmation).not.toHaveBeenCalled()
    expect(body).toHaveBeenCalledOnce()
    expect(res.success).toBe(true)
  })
})
