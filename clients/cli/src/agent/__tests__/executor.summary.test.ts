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
const USDC_CONTRACT = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
const WETH_CONTRACT = '0x4200000000000000000000000000000000000006'

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

  it('token-to-native swap discloses the sell token contract only', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~24.17 POL via swapkit',
        from_token: `USDC (${USDC_CONTRACT} on Polygon, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: 'POL (native on Polygon, 18 dec, source: native)',
        to_token_symbol: 'POL',
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~24.17 POL via swapkit on Base (+ token approval — 2 transactions)`
    )
  })

  it('token-to-token swap discloses both token contracts', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token: `USDC (${USDC_CONTRACT} on Polygon, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~0.001 WETH (${WETH_CONTRACT}) via swapkit on Base (+ token approval — 2 transactions)`
    )
  })

  it('Skip-shaped labels disclose contracts without separate symbol fields', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via Skip Go',
        amount_in: '2 USDC',
        expected_output: '0.001 WETH',
        from_token: `USDC (${USDC_CONTRACT} on Polygon, 6 dec, source: known)`,
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~0.001 WETH (${WETH_CONTRACT}) via Skip Go on Base (+ token approval — 2 transactions)`
    )
  })

  it('delimiter-bearing token symbols cannot suppress contract disclosure', () => {
    const executor = new AgentExecutor(createMockVault())
    const adversarialSymbol = 'SCAM (\n → ETH'
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: `2 ${adversarialSymbol} → ~0.001 WETH via swapkit`,
        amount_in: `2 ${adversarialSymbol}`,
        expected_output: '0.001 WETH',
        from_token: `${adversarialSymbol} (${USDC_CONTRACT} on Base, 6 dec, source: rpc)`,
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 ${adversarialSymbol} (${USDC_CONTRACT}) → ~0.001 WETH (${WETH_CONTRACT}) via swapkit on Base (+ token approval — 2 transactions)`
    )
  })

  it('native-only swap summary remains byte-identical', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction({
      chain: 'Base',
      swap_tx: SWAP_TX,
      resolved: {
        labels: {
          quote_summary: '2 POL → ~0.001 ETH via swapkit',
          from_token: 'POL (native on Polygon, 18 dec, source: native)',
          from_token_symbol: 'POL',
          to_token: 'ETH (native on Ethereum, 18 dec, source: native)',
          to_token_symbol: 'ETH',
        },
      },
    })

    expect(executor.getPendingSummary()).toBe('2 POL → ~0.001 ETH via swapkit on Base')
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

  it('swap without quote_summary still discloses token contracts', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        amount_in: '0.01 USDC',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
        provider: 'kyber',
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `swap 0.01 USDC (${USDC_CONTRACT}) USDC → WETH (${WETH_CONTRACT}) on Base via kyber (+ token approval — 2 transactions)`
    )
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

  // PR #682 CodeRabbit follow-up: a bare numeric amount must carry the asset
  // symbol so the confirmation prompt can never be ambiguous between native
  // and tokens on the same chain ("send 100 on Base to …" — ETH or USDC?).
  it('send with token_resolved label injects symbol after a bare amount', () => {
    const executor = new AgentExecutor(createMockVault())
    expect(
      executor.storeServerTransaction({
        chain: 'Base',
        txArgs: { chain: 'Base', to: '0xRecipientAddr', amount: '500000', tx: { to: '0xRecipientAddr', value: '0' } },
        resolved: { labels: { token_resolved: 'USDC' } },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 500000 USDC on Base to 0xRecipientAddr')
  })

  it('send with resolved_amount that already embeds the symbol does not duplicate it', () => {
    const executor = new AgentExecutor(createMockVault())
    expect(
      executor.storeServerTransaction({
        chain: 'Base',
        txArgs: { chain: 'Base', to: '0xRecipientAddr', amount: '500000', tx: { to: '0xRecipientAddr', value: '0' } },
        resolved: { labels: { resolved_amount: '0.5 USDC', token_resolved: 'USDC' } },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.5 USDC on Base to 0xRecipientAddr')
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
