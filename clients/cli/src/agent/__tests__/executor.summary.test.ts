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

const USDC_CONTRACT = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
const WETH_CONTRACT = '0x4200000000000000000000000000000000000006'
const ETH_USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const SPOOFED_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const APPROVE_TX = {
  to: USDC_CONTRACT,
  value: '0',
  data: '0x095ea7b3' + '0'.repeat(120),
  gas_limit: '60000',
}
const SWAP_TX = { to: '0xRouter', value: '0', data: '0xdeadbeef', gas_limit: '250000' }

function makeMultiLegEnvelope(
  labels: Record<string, unknown>,
  options: { approvalTx?: Record<string, unknown>; toChain?: string } = {}
) {
  return {
    chain: 'Base',
    from_chain: 'Base',
    approvalTxArgs: {
      chain: 'Base',
      chain_id: '8453',
      from: '0xsender',
      tx: options.approvalTx ?? APPROVE_TX,
    },
    txArgs: { chain: 'Base', chain_id: '8453', from: '0xsender', tx: SWAP_TX },
    // The real mcp-ts prep envelope carries the routed destination inside
    // resolved.labels (`to_chain`), never at the top level.
    resolved: { labels: { ...(options.toChain ? { to_chain: options.toChain } : {}), ...labels } },
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
          from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
          from_token_symbol: 'USDC',
          to_token: 'ETH (native on Base, 18 dec, source: native)',
          to_token_symbol: 'ETH',
          provider: 'kyber',
          estimated_fee: '~0.0000038 ETH',
        })
      )
    ).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`0.01 USDC (${USDC_CONTRACT}) → ~0.000006 ETH via kyber`)
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
        quote_summary: '2 USDC → ~0.001 ETH via swapkit',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: 'ETH (native on Base, 18 dec, source: native)',
        to_token_symbol: 'ETH',
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~0.001 ETH via swapkit on Base (+ token approval — 2 transactions)`
    )
  })

  it('token-to-token swap discloses both token contracts', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~0.001 WETH (${WETH_CONTRACT}) via swapkit on Base (+ token approval — 2 transactions)`
    )
  })

  it('uses the signed approval target and suppresses a mismatching sell-label contract', () => {
    const executor = new AgentExecutor(createMockVault())
    const mismatchingClaim = '0x1111111111111111111111111111111111111111'
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token: `USDC (${mismatchingClaim} on Base, 6 dec, source: rpc)`,
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`2 USDC (${USDC_CONTRACT})`)
    expect(summary).not.toContain(mismatchingClaim)
  })

  it('renders the approval target the signer will actually sign, ignoring decoy sibling tx fields', () => {
    const executor = new AgentExecutor(createMockVault())
    const decoyTarget = '0x3333333333333333333333333333333333333333'
    const envelope = makeMultiLegEnvelope({
      quote_summary: '2 USDC → ~0.001 WETH via swapkit',
      from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
      from_token_symbol: 'USDC',
      to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
      to_token_symbol: 'WETH',
    })
    // signMultiLeg re-parents approvalTxArgs as txArgs and clears sibling tx
    // fields, so the signer's approve target is approvalTxArgs.tx.to — a
    // decoy swap_tx inside approvalTxArgs must not reach the consent line.
    ;(envelope.approvalTxArgs as Record<string, unknown>).swap_tx = { to: decoyTarget, data: '0xdeadbeef' }
    executor.storeServerTransaction(envelope)

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`2 USDC (${USDC_CONTRACT})`)
    expect(summary).not.toContain(decoyTarget)
  })

  it('does not let interior route prose satisfy the buy-side anchor', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~1 output routed through WETH pool via kyber',
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('~1 output routed through WETH pool (contract unavailable)')
    expect(summary).not.toContain(WETH_CONTRACT)
  })

  it('marks a malformed buy descriptor unavailable while preserving the signed sell contract', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 decimals, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    expect(executor.getPendingSummary()).toContain(`USDC (${USDC_CONTRACT}) → ~0.001 WETH (contract unavailable)`)
  })

  it('handles a non-string descriptor without throwing and marks it unavailable', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token_symbol: 'USDC',
        to_token: { symbol: 'WETH', contract: WETH_CONTRACT },
        to_token_symbol: 'WETH',
      })
    )

    expect(() => executor.getPendingSummary()).not.toThrow()
    expect(executor.getPendingSummary()).toContain('WETH (contract unavailable) via swapkit')
  })

  it('marks a missing signed sell target unavailable while preserving a resolved buy contract', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~0.001 WETH via swapkit',
          from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
          from_token_symbol: 'USDC',
          to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
          to_token_symbol: 'WETH',
        },
        { approvalTx: { ...APPROVE_TX, to: undefined } }
      )
    )

    expect(executor.getPendingSummary()).toContain(`USDC (contract unavailable) → ~0.001 WETH (${WETH_CONTRACT})`)
  })

  it('rejects a buy contract descriptor that contradicts the routed destination chain', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~0.001 WETH via swapkit',
          from_token_symbol: 'USDC',
          to_token: `WETH (${WETH_CONTRACT} on Ethereum, 18 dec, source: known)`,
          to_token_symbol: 'WETH',
        },
        { toChain: 'Base' }
      )
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('WETH (contract unavailable) via swapkit')
    expect(summary).not.toContain(WETH_CONTRACT)
  })

  it('accepts a cross-chain buy descriptor when the envelope names no routed chain (Skip shape)', () => {
    const executor = new AgentExecutor(createMockVault())
    const atomDenom = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.5 ATOM via Skip Go',
        amount_in: '2 USDC',
        expected_output: '0.5 ATOM',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        to_token: `ATOM (${atomDenom} on Cosmos, 6 dec, source: known)`,
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`~0.5 ATOM (${atomDenom}) via Skip Go`)
    expect(summary).not.toContain('contract unavailable')
  })

  it('cross-chain native destination renders without an unavailable marker', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~0.0003 BTC via THORChain',
          from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
          from_token_symbol: 'USDC',
          to_token: 'BTC (native on Bitcoin, 8 dec, source: native)',
          to_token_symbol: 'BTC',
        },
        { toChain: 'Bitcoin' }
      )
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~0.0003 BTC via THORChain on Base (+ token approval — 2 transactions)`
    )
  })

  it('rejects a non-address contract identity on an EVM destination', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token_symbol: 'USDC',
        to_token: 'WETH (not-an-address on Base, 18 dec, source: rpc)',
        to_token_symbol: 'WETH',
      })
    )

    expect(executor.getPendingSummary()).toContain('WETH (contract unavailable) via swapkit')
  })

  it('rejects a non-EVM asset id carrying whitespace or control characters', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~2 USDT via jupiter',
          from_token_symbol: 'USDC',
          to_token: 'USDT (\u001b[2J\u001b[H APPROVED on Solana, 6 dec, source: rpc)',
          to_token_symbol: 'USDT',
        },
        { toChain: 'Solana' }
      )
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('USDT (contract unavailable) via jupiter')
    expect(summary).not.toContain('\u001b')
    expect(summary).not.toContain('APPROVED')
  })

  it('discloses a shape-valid non-EVM asset id on its routed chain', () => {
    const executor = new AgentExecutor(createMockVault())
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~2 USDC via jupiter',
          from_token_symbol: 'USDC',
          to_token: `USDC (${usdcMint} on Solana, 6 dec, source: known)`,
          to_token_symbol: 'USDC',
        },
        { toChain: 'Solana' }
      )
    )

    expect(executor.getPendingSummary()).toContain(`USDC (${usdcMint}) via jupiter`)
  })

  it('bounds hostile oversized labels instead of stalling the consent gate', () => {
    const executor = new AgentExecutor(createMockVault())
    const hostileLabel = `WETH ${'( on '.repeat(4000)}x`
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via swapkit',
        from_token_symbol: 'USDC',
        to_token: hostileLabel,
        to_token_symbol: 'WETH',
      })
    )

    // Vitest's per-test timeout is the regression guard: an unbounded label
    // sends the descriptor regexes superlinear (minutes at this size).
    expect(executor.getPendingSummary()).toContain('WETH (contract unavailable) via swapkit')
  })

  it('treats an overlong symbol as spoof-suspect and strips its payload', () => {
    const executor = new AgentExecutor(createMockVault())
    const spoofMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const spoofSymbol = `USDT ${spoofMint}`
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: `2 USDC → ~2 ${spoofSymbol} via jupiter`,
        amount_in: '2 USDC',
        expected_output: `2 ${spoofSymbol}`,
        from_token_symbol: 'USDC',
        to_token: `${spoofSymbol} (${WETH_CONTRACT} on Base, 6 dec, source: rpc)`,
        to_token_symbol: spoofSymbol,
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).not.toContain(spoofMint)
    // A spoof-suspect symbol also disqualifies the descriptor's contract
    // claim, so the buy side degrades to the explicit marker.
    expect(summary).toContain('USDT (contract unavailable) via jupiter')
  })

  it('non-native sell without an approval leg renders the unavailable marker', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction({
      chain: 'Base',
      from_chain: 'Base',
      txArgs: { chain: 'Base', chain_id: '8453', from: '0xsender', tx: SWAP_TX },
      resolved: {
        labels: {
          quote_summary: '2 USDC → ~0.001 ETH via swapkit',
          from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
          from_token_symbol: 'USDC',
          to_token: 'ETH (native on Base, 18 dec, source: native)',
          to_token_symbol: 'ETH',
        },
      },
    })

    expect(executor.getPendingSummary()).toBe('2 USDC (contract unavailable) → ~0.001 ETH via swapkit on Base')
  })

  it('accepts a cross-chain buy contract on the declared destination chain', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~1.99 USDC via bridge',
          from_token_symbol: 'USDC',
          to_token: `USDC (${ETH_USDC_CONTRACT} on Ethereum, 6 dec, source: known)`,
          to_token_symbol: 'USDC',
        },
        { toChain: 'Ethereum' }
      )
    )

    expect(executor.getPendingSummary()).toContain(
      `USDC (${USDC_CONTRACT}) → ~1.99 USDC (${ETH_USDC_CONTRACT}) via bridge`
    )
  })

  it('does not attach the buy contract to provider text when expected_output is absent', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 output via WETH Router',
        from_token_symbol: 'USDC',
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('~0.001 output (contract unavailable) via WETH Router')
    expect(summary).not.toContain(WETH_CONTRACT)
  })

  it('does not anchor a bare symbol inside a longer route token', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~1 USDT.e route',
        from_token_symbol: 'USDC',
        to_token: `USDT (${WETH_CONTRACT} on Base, 6 dec, source: known)`,
        to_token_symbol: 'USDT',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('~1 USDT.e route (contract unavailable)')
    expect(summary).not.toContain(WETH_CONTRACT)
  })

  it('does not anchor a bare symbol inside a plus-suffixed route token', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~1 USDT+ route',
        from_token_symbol: 'USDC',
        to_token: `USDT (${WETH_CONTRACT} on Base, 6 dec, source: known)`,
        to_token_symbol: 'USDT',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain('~1 USDT+ route (contract unavailable)')
    expect(summary).not.toContain(WETH_CONTRACT)
  })

  it('keeps same-symbol cross-chain contracts on their respective arrow halves', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope(
        {
          quote_summary: '2 USDC → ~1.99 USDC via bridge',
          amount_in: '2 USDC',
          expected_output: '1.99 USDC',
          from_token_symbol: 'USDC',
          to_token: `USDC (${ETH_USDC_CONTRACT} on Ethereum, 6 dec, source: known)`,
          to_token_symbol: 'USDC',
        },
        { toChain: 'Ethereum' }
      )
    )

    expect(executor.getPendingSummary()).toBe(
      `2 USDC (${USDC_CONTRACT}) → ~1.99 USDC (${ETH_USDC_CONTRACT}) via bridge on Base (+ token approval — 2 transactions)`
    )
  })

  it('strips a spoofed descriptor prefix before rendering signed contract truth', () => {
    const executor = new AgentExecutor(createMockVault())
    const spoofedSymbol = `FAKE (${SPOOFED_CONTRACT} on Ethereum, 6 dec, source: known)`
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: `2 ${spoofedSymbol} → ~0.001 WETH via swapkit`,
        amount_in: `2 ${spoofedSymbol}`,
        from_token: `${spoofedSymbol} (${USDC_CONTRACT} on Base, 6 dec, source: rpc)`,
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`2 FAKE (${USDC_CONTRACT}) →`)
    expect(summary).not.toContain(SPOOFED_CONTRACT)
  })

  it('strips a spoofed prefix even when the containing descriptor is malformed', () => {
    const executor = new AgentExecutor(createMockVault())
    const spoofedSymbol = `FAKE (${SPOOFED_CONTRACT} on Ethereum, 6 dec, source: known)`
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: `2 ${spoofedSymbol} → ~0.001 WETH via swapkit`,
        amount_in: `2 ${spoofedSymbol}`,
        from_token_symbol: spoofedSymbol,
        from_token: `${spoofedSymbol} (${USDC_CONTRACT} on Base, 6 decimals, source: rpc)`,
        to_token: `WETH (${WETH_CONTRACT} on Base, 18 dec, source: known)`,
        to_token_symbol: 'WETH',
      })
    )

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`2 FAKE (${USDC_CONTRACT}) →`)
    expect(summary).not.toContain(SPOOFED_CONTRACT)
  })

  it('Skip-shaped labels disclose contracts without separate symbol fields', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        quote_summary: '2 USDC → ~0.001 WETH via Skip Go',
        amount_in: '2 USDC',
        expected_output: '0.001 WETH',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
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
          quote_summary: '2 ETH → ~0.001 ETH via swapkit',
          from_token: 'ETH (native on Base, 18 dec, source: native)',
          from_token_symbol: 'ETH',
          to_token: 'ETH (native on Base, 18 dec, source: native)',
          to_token_symbol: 'ETH',
        },
      },
    })

    expect(executor.getPendingSummary()).toBe('2 ETH → ~0.001 ETH via swapkit on Base')
  })

  it('swap without quote_summary: builds head from labels and appends provider once', () => {
    const executor = new AgentExecutor(createMockVault())
    executor.storeServerTransaction(
      makeMultiLegEnvelope({
        amount_in: '0.01 USDC',
        from_token: `USDC (${USDC_CONTRACT} on Base, 6 dec, source: known)`,
        from_token_symbol: 'USDC',
        to_token: 'ETH (native on Base, 18 dec, source: native)',
        to_token_symbol: 'ETH',
        provider: 'kyber',
      })
    )
    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`swap 0.01 USDC (${USDC_CONTRACT}) → ETH`)
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
      `swap 0.01 USDC (${USDC_CONTRACT}) → WETH (${WETH_CONTRACT}) on Base via kyber (+ token approval — 2 transactions)`
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
