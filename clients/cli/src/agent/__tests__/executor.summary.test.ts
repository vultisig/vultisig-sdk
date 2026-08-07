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

  // The tokenLabel guard in executor.ts is ONLY load-bearing when resolved_amount carries the FULL
  // rich label rather than the bare ticker. The sibling case below uses '0.05 USDC.e', for which
  // `amount.endsWith(' ' + symbol)` already short-circuits - so it passes with the guard REMOVED and
  // pins nothing. This is the shape that regressed: narrowing `symbol` to the first word made the
  // endsWith miss, and the whole label was appended a second time.
  //
  //   without the guard: 'send 0.05 USDC.e on Polygon (0x2791...4174) USDC.e to ...'
  it('does not re-append the ticker when resolved_amount already carries the FULL rich label', () => {
    const executor = new AgentExecutor(createMockVault())

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: '0.05 USDC.e on Polygon (0x2791…4174)',
            token_resolved: 'USDC.e on Polygon (0x2791…4174)',
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toBe('send 0.05 USDC.e on Polygon (0x2791…4174) to 0x58C4…5C35')
    // The assertion that actually catches the regression: exactly one occurrence of each.
    expect(summary.match(/USDC\.e/g)).toHaveLength(1)
    expect(summary.match(/Polygon/g)).toHaveLength(1)
    expect(summary.match(/0x2791…4174/g)).toHaveLength(1)
  })

  it('renders rich token, native, and bare token labels without duplicated consent details', () => {
    const executor = new AgentExecutor(createMockVault())

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: '0.05 USDC.e',
            token_resolved: 'USDC.e on Polygon (0x2791…4174)',
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    const tokenSummary = executor.getPendingSummary()!
    expect(tokenSummary).toBe('send 0.05 USDC.e on Polygon (0x2791…4174) to 0x58C4…5C35')
    expect(tokenSummary.match(/USDC\.e/g)).toHaveLength(1)
    expect(tokenSummary.match(/Polygon/g)).toHaveLength(1)
    expect(tokenSummary).toContain('(0x2791…4174)')

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: '0.05 USDC.e',
            token_resolved: 'USDC.e (0x2791…4174)',
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.05 USDC.e on Polygon (0x2791…4174) to 0x58C4…5C35')

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x58C4…5C35', value: '1' } },
        resolved: { labels: { resolved_amount: '0.01 POL', recipient_echo: '0x58C4…5C35' } },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.01 POL on Polygon to 0x58C4…5C35')

    expect(
      executor.storeServerTransaction({
        chain: 'Base',
        txArgs: { chain: 'Base', to: '0xRecipientAddr', amount: '500000', tx: { to: '0xUSDC', value: '0' } },
        resolved: { labels: { token_resolved: 'USDC' } },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 500000 USDC on Base to 0xRecipientAddr')
  })

  it('does not append a rich token label already embedded in the resolved amount', () => {
    const executor = new AgentExecutor(createMockVault())
    const tokenLabel = 'USDC.e on Polygon (0x2791…4174)'

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: `0.05 ${tokenLabel}`,
            token_resolved: tokenLabel,
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toBe(`send 0.05 ${tokenLabel} to 0x58C4…5C35`)
    expect(summary.match(/USDC\.e on Polygon \(0x2791…4174\)/g)).toHaveLength(1)
  })

  it.each([
    [
      'a different primary chain',
      'USDC.e on Ethereum (0xA0b8…eB48)',
      'send 0.05 USDC.e on Ethereum (0xA0b8…eB48) on Polygon to 0x58C4…5C35',
    ],
    [
      'the routed chain only in a secondary negated phrase',
      'USDC.e on Ethereum (0xA0b8…eB48) not on Polygon',
      'send 0.05 USDC.e on Ethereum (0xA0b8…eB48) not on Polygon on Polygon to 0x58C4…5C35',
    ],
  ])('keeps the routed chain when an embedded full token label names %s', (_shape, tokenLabel, expected) => {
    const executor = new AgentExecutor(createMockVault())

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0xA0b8…eB48', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: `0.05 ${tokenLabel}`,
            token_resolved: tokenLabel,
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    expect(executor.getPendingSummary()).toBe(expected)
  })

  it.each([
    [
      'multi-word asset name',
      '0.05 USD Coin',
      'USD Coin on Polygon (0x2791…4174)',
      'send 0.05 USD Coin USD on Polygon Coin (0x2791…4174) to 0x58C4…5C35',
    ],
    [
      'lowercase chain in label',
      '0.05 USDC.e',
      'USDC.e on polygon (0x2791…4174)',
      'send 0.05 USDC.e on Polygon on polygon (0x2791…4174) to 0x58C4…5C35',
    ],
    [
      'chain named twice in label',
      '0.05 USDC.e',
      'USDC.e on Polygon on Polygon (0x2791…4174)',
      'send 0.05 USDC.e on Polygon on Polygon (0x2791…4174) to 0x58C4…5C35',
    ],
  ])('keeps the non-lossy fallback for %s', (_shape, resolvedAmount, tokenLabel, expected) => {
    const executor = new AgentExecutor(createMockVault())

    expect(
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: {
            resolved_amount: resolvedAmount,
            token_resolved: tokenLabel,
            recipient_echo: '0x58C4…5C35',
          },
        },
      })
    ).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toBe(expected)
    expect(summary).toContain('(0x2791…4174)')
  })

  it('never drops label details it cannot parse — unexpected shapes stay verbatim', () => {
    const executor = new AgentExecutor(createMockVault())
    const store = (token_resolved: string) =>
      executor.storeServerTransaction({
        chain: 'Polygon',
        txArgs: { chain: 'Polygon', tx: { to: '0x2791…4174', value: '0' } },
        resolved: {
          labels: { resolved_amount: '0.05 USDC.e', token_resolved, recipient_echo: '0x58C4…5C35' },
        },
      })

    // Contract before the chain: the disclosure must survive re-ordering.
    expect(store('USDC.e (0x2791…4174) on Polygon')).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.05 USDC.e on Polygon (0x2791…4174) to 0x58C4…5C35')

    // Trailing annotation after the contract: keep everything.
    expect(store('USDC.e on Polygon (0x2791…4174) [bridged]')).toBe(true)
    expect(executor.getPendingSummary()).toBe('send 0.05 USDC.e on Polygon (0x2791…4174) [bridged] to 0x58C4…5C35')

    // Label claims a different chain than the routed transaction: the routed
    // chain anchors the summary, but the conflicting claim must stay visible.
    expect(store('USDC.e on Ethereum (0xA0b8…eB48)')).toBe(true)
    const mismatch = executor.getPendingSummary()!
    expect(mismatch).toBe('send 0.05 USDC.e on Polygon on Ethereum (0xA0b8…eB48) to 0x58C4…5C35')
    expect(mismatch).toContain('on Ethereum')
    expect(mismatch).toContain('(0xA0b8…eB48)')
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
