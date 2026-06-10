/**
 * getPendingSummary() unit tests — the human-readable line shown in the
 * pre-sign confirmation prompt (security gate for vultisig-sdk#679). The
 * summary is what the user approves, so its rendering rules are pinned:
 * quote_summary reuse (no duplicated provider), multi-leg disclosure,
 * send fallbacks, and '?' placeholders for missing fields. Also covers
 * clearPendingTransaction() and the stale-pendingLegs reset on re-store.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Base],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
  } as unknown as VaultBase
}

const APPROVE_TX = { to: '0xUSDC', value: '0', data: '0x095ea7b3' + '0'.repeat(120), gas_limit: '60000' }
const SWAP_TX = { to: '0xRouter', value: '0', data: '0xdeadbeef', gas_limit: '250000' }

function makeMultiLegEnvelope(labels: Record<string, string>) {
  return {
    chain: 'Base',
    from_chain: 'Base',
    approvalTxArgs: { chain: 'Base', chain_id: '8453', from: '0xsender', tx: APPROVE_TX },
    txArgs: { chain: 'Base', chain_id: '8453', from: '0xsender', tx: SWAP_TX },
    resolved: { labels },
  }
}

describe('AgentExecutor.getPendingSummary', () => {
  it('returns null when nothing is buffered', () => {
    const executor = new AgentExecutor(createMockVault())
    expect(executor.getPendingSummary()).toBeNull()
  })

  it('multi-leg swap with quote_summary: reuses it, discloses both txs, no duplicated provider', () => {
    const executor = new AgentExecutor(createMockVault())
    expect(
      executor.storeServerTransaction(
        makeMultiLegEnvelope({
          quote_summary: '0.01 USDC → ~0.000006 ETH via kyber',
          provider: 'kyber',
          estimated_fee: '~0.0000038 ETH',
        })
      )
    ).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toContain('0.01 USDC → ~0.000006 ETH via kyber')
    expect(summary).toContain('on Base')
    expect(summary).toContain('(+ token approval — 2 transactions)')
    expect(summary).toContain('est. fee ~0.0000038 ETH')
    // quote_summary already embeds the provider — must not append "via kyber" again
    expect(summary.match(/via kyber/g)).toHaveLength(1)
  })

  it('swap without quote_summary: builds head from labels and appends provider once', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        amount_in: '0.01 USDC',
        from_token_symbol: 'USDC',
        to_token_symbol: 'ETH',
        provider: 'kyber',
      })
    )
    const summary = executor.getPendingSummary()!
    expect(summary).toContain('swap 0.01 USDC USDC → ETH')
    expect(summary).toContain('via kyber')
    expect(summary).toContain('(+ token approval — 2 transactions)')
  })

  it('single-leg send: renders resolved_amount and txArgs.to', () => {
    const executor = new AgentExecutor(createMockVault())
    expect(
      executor.storeServerTransaction({
        chain: 'Base',
        txArgs: { chain: 'Base', to: '0xRecipientAddr', amount: '500000', tx: { to: '0xRecipientAddr', value: '0' } },
        resolved: { labels: { resolved_amount: '0.5 USDC' } },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.5 USDC on Base to 0xRecipientAddr')
  })

  it("send with no labels and no txArgs falls back to '?' placeholders", () => {
    const executor = new AgentExecutor(createMockVault())
    expect(executor.storeServerTransaction({ tx: { to: '0xSomewhere', value: '1' } })).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toContain('send ?')
    expect(summary).toContain('to ?')
  })
})

describe('AgentExecutor pending-state hygiene (decline path)', () => {
  it('clearPendingTransaction drops the buffer and staged legs', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(makeMultiLegEnvelope({ quote_summary: 'q' }))
    expect(executor.hasPendingTransaction()).toBe(true)
    expect(((executor as any).pendingLegs as unknown[]).length).toBe(2)

    executor.clearPendingTransaction()
    expect(executor.hasPendingTransaction()).toBe(false)
    expect(((executor as any).pendingLegs as unknown[]).length).toBe(0)
    expect(executor.getPendingSummary()).toBeNull()
  })

  it('storing a single-leg tx resets stale legs left by a declined multi-leg envelope', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(makeMultiLegEnvelope({ quote_summary: 'q' }))
    expect(((executor as any).pendingLegs as unknown[]).length).toBe(2)

    // Decline doesn't sign, so legs survive until the next store — which must reset them.
    executor.storeServerTransaction({
      chain: 'Base',
      txArgs: { chain: 'Base', to: '0xR', amount: '1', tx: { to: '0xR', value: '1' } },
    })
    expect(((executor as any).pendingLegs as unknown[]).length).toBe(0)
  })
})
