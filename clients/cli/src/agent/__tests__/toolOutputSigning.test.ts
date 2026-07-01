/**
 * Design B — Polymarket flat-tx-builder output → signable tx_ready bridge.
 *
 * These tests pin the guard + wrapping contract that lets the headless CLI sign
 * `polymarket_deposit` / `polymarket_setup_trading` outputs the way mobile does:
 *  - a valid flat envelope → wrapped `{chain,chain_id,tx:{…}}` (executor's
 *    `extractNestedTx` reads `tx`, NOT a bare top-level `{to,value,data}`);
 *  - a bundled deposit approve→wrap → multi-leg `{approvalTxArgs,txArgs}` so the
 *    executor sequences approve→receipt→wrap (closes the funds-regression where
 *    a lone wrap reverts on a stale allowance);
 *  - every non-tx result (`no_op`, `insufficient_usdce`, errors) → null (NOT
 *    signed).
 *
 * The wrapped shapes are validated end-to-end against the real executor in
 * `executor.buildtx.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  buildTxReadyFromToolOutput,
  CLI_SIGNABLE_FLAT_TOOLS,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '../toolOutputSigning'

const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const ONRAMP = '0x1234567890abcdef1234567890abcdef12345678'
const APPROVE_DATA = '0x095ea7b3' + '0'.repeat(120)
const WRAP_DATA = '0x62355638' + '0'.repeat(192)

/** A realistic `polymarket_setup_trading` approve envelope. */
function setupTradingApprove() {
  return {
    chain: 'Polygon',
    chain_id: '137',
    to: USDC_E,
    value: '0',
    data: APPROVE_DATA,
    action: 'approve',
    maker_address: '0x000000000000000000000000000000000000dEaD',
    spender_name: 'CTF Exchange',
  }
}

/** A realistic `polymarket_deposit` step-1 approve envelope. */
function depositApprove() {
  return {
    chain: 'Polygon',
    chain_id: '137',
    to: USDC_E,
    value: '0',
    data: APPROVE_DATA,
    action: 'approve',
    step: 1,
    total_steps: 2,
    next_step: 'wrap',
  }
}

/** A realistic `polymarket_deposit` wrap envelope WITHOUT a bundled approval. */
function depositWrapPlain() {
  return {
    chain: 'Polygon',
    chain_id: '137',
    to: ONRAMP,
    value: '0',
    data: WRAP_DATA,
    gas_limit: '250000',
    action: 'wrap_usdce_to_pusd',
    step: 2,
    total_steps: 2,
  }
}

/** A realistic `polymarket_deposit` wrap envelope WITH a bundled approval leg. */
function depositWrapBundled() {
  return {
    ...depositWrapPlain(),
    needs_approval: true,
    approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0' },
  }
}

describe('CLI_SIGNABLE_FLAT_TOOLS', () => {
  it('includes the flat Polymarket builders and the flat produces_calldata tools', () => {
    // Polymarket flat builders (no tx_ready) + flat produces_calldata tools that
    // DO emit tx_ready (erc20_approve) or a structurally-unsignable one
    // (build_custom_* — divergent to_address/calldata).
    for (const t of [
      POLYMARKET_DEPOSIT_TOOL,
      POLYMARKET_SETUP_TRADING_TOOL,
      'erc20_approve',
      'build_custom_credit_topup',
    ]) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(true)
    }
  })

  it('excludes EIP-712 / non-flat tools (signed via sign_typed_data)', () => {
    expect(CLI_SIGNABLE_FLAT_TOOLS.has('polymarket_place_bet')).toBe(false)
    expect(CLI_SIGNABLE_FLAT_TOOLS.has('polymarket_setup_deposit_wallet')).toBe(false)
    // execute_* are PREP (parity-only), NOT in the flat-enrichment allowlist.
    expect(CLI_SIGNABLE_FLAT_TOOLS.has('execute_swap')).toBe(false)
  })
})

describe('buildTxReadyFromToolOutput — allowlist gate', () => {
  it('returns null for a tool not in the allowlist', () => {
    expect(buildTxReadyFromToolOutput('polymarket_place_bet', setupTradingApprove())).toBeNull()
    expect(buildTxReadyFromToolOutput('execute_swap', setupTradingApprove())).toBeNull()
    expect(buildTxReadyFromToolOutput('polymarket_setup_deposit_wallet', setupTradingApprove())).toBeNull()
  })
})

describe('buildTxReadyFromToolOutput — valid flat envelopes → single-leg tx', () => {
  it('wraps a setup_trading approve into {chain,chain_id,tx}', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, setupTradingApprove())
    expect(out).not.toBeNull()
    expect(out).toMatchObject({
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
    })
    // single-leg: no multi-leg markers
    expect(out?.approvalTxArgs).toBeUndefined()
    expect(out?.txArgs).toBeUndefined()
  })

  it('wraps a deposit approve step into {chain,chain_id,tx}', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositApprove())
    expect(out).toMatchObject({ chain: 'Polygon', chain_id: '137', tx: { to: USDC_E, data: APPROVE_DATA } })
    expect(out?.approvalTxArgs).toBeUndefined()
  })

  it('wraps a plain deposit wrap step and carries the server gas_limit', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapPlain())
    expect(out).toMatchObject({
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: ONRAMP, value: '0', data: WRAP_DATA, gas_limit: '250000' },
    })
    expect(out?.approvalTxArgs).toBeUndefined()
  })

  it('parses a stringified JSON envelope identically', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, JSON.stringify(setupTradingApprove()))
    expect(out).toMatchObject({ chain: 'Polygon', tx: { to: USDC_E, data: APPROVE_DATA } })
  })

  it('defaults a missing value to "0"', () => {
    const env = setupTradingApprove() as Record<string, unknown>
    delete env.value
    const out = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)
    expect(out?.tx).toMatchObject({ value: '0' })
  })

  it('normalizes a malformed value to "0" (never reaches BigInt as-is)', () => {
    // The tx is still signed (to+data are valid); only the malformed value is
    // sanitized to '0' so executor's BigInt(value) can't throw / over-send.
    const env = { ...setupTradingApprove(), value: 'not-a-number' }
    const out = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)
    expect(out?.tx).toMatchObject({ to: USDC_E, value: '0', data: APPROVE_DATA })
  })

  it('drops a malformed gas_limit (so the SDK estimates instead of throwing)', () => {
    const env = { ...depositWrapPlain(), gas_limit: '250000 wei' }
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)
    expect(out?.tx).toMatchObject({ to: ONRAMP, data: WRAP_DATA })
    expect((out?.tx as Record<string, unknown>)?.gas_limit).toBeUndefined()
  })

  it('marks the envelope __buildTx and passes the action through (for the confirm summary)', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapPlain())
    expect(out?.__buildTx).toBe(true)
    expect(out?.action).toBe('wrap_usdce_to_pusd')
  })
})

describe('buildTxReadyFromToolOutput — bundled approve+wrap → multi-leg', () => {
  it('maps needs_approval+approval_tx onto approvalTxArgs/txArgs with nested tx', () => {
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapBundled())
    expect(out).not.toBeNull()
    expect(out).toMatchObject({
      chain: 'Polygon',
      chain_id: '137',
      approvalTxArgs: { chain: 'Polygon', chain_id: '137', tx: { to: USDC_E, value: '0', data: APPROVE_DATA } },
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        tx: { to: ONRAMP, value: '0', data: WRAP_DATA, gas_limit: '250000' },
      },
    })
    // a multi-leg envelope must NOT also carry a single-leg `tx`
    expect(out?.tx).toBeUndefined()
  })

  it('routes a TRUTHY non-boolean needs_approval (1) through the bundled multi-leg path', () => {
    // hardening: a non-boolean-truthy needs_approval must NOT fall through to
    // signing the wrap alone against a stale allowance.
    const env = { ...depositWrapBundled(), needs_approval: 1 }
    const out = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)
    expect(out?.approvalTxArgs).toMatchObject({ tx: { to: USDC_E, data: APPROVE_DATA } })
    expect(out?.txArgs).toMatchObject({ tx: { to: ONRAMP, data: WRAP_DATA } })
  })

  it('FAILS CLOSED: truthy needs_approval (1) but approval_tx missing → null (never the lone wrap)', () => {
    const env = { ...depositWrapPlain(), needs_approval: 1 }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)).toBeNull()
  })

  it('FAILS CLOSED: needs_approval=true but approval_tx missing → null (never sign the wrap alone)', () => {
    const env = { ...depositWrapPlain(), needs_approval: true }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)).toBeNull()
  })

  it('FAILS CLOSED: needs_approval=true but approval_tx has no calldata → null', () => {
    const env = { ...depositWrapPlain(), needs_approval: true, approval_tx: { to: USDC_E, value: '0' } }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)).toBeNull()
  })

  it('FAILS CLOSED: needs_approval=true but approval_tx carries an error marker → null', () => {
    const env = {
      ...depositWrapPlain(),
      needs_approval: true,
      approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0', error: 'simulated approve failure' },
    }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)).toBeNull()
  })

  it('FAILS CLOSED: needs_approval=true but main wrap tx missing data → null', () => {
    const env = {
      chain: 'Polygon',
      chain_id: '137',
      to: ONRAMP,
      value: '0',
      needs_approval: true,
      approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0' },
    }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)).toBeNull()
  })
})

describe('buildTxReadyFromToolOutput — flat produces_calldata tools (generalized past polymarket)', () => {
  it('wraps a standalone erc20_approve flat envelope into {chain,chain_id,tx}', () => {
    const env = { chain: 'Base', chain_id: '8453', to: USDC_E, value: '0', data: APPROVE_DATA }
    const out = buildTxReadyFromToolOutput('erc20_approve', env)
    expect(out).toMatchObject({ chain: 'Base', chain_id: '8453', tx: { to: USDC_E, value: '0', data: APPROVE_DATA } })
  })

  it('NORMALIZES the divergent build_custom_credit_topup card (to_address→to, calldata→data)', () => {
    // mcp-ts payments card uses to_address/calldata; the executor signer reads
    // to/data. The per-tool normalizer makes it signable client-side (it is NOT
    // signable off the backend tx_ready, which wraps to_address/calldata verbatim).
    const ROUTER = '0x1111111111111111111111111111111111111111'
    const card = {
      kind: 'credit_topup',
      chain: 'Polygon',
      chain_id: '137',
      to_address: ROUTER,
      token_contract: USDC_E,
      calldata: WRAP_DATA,
      from_address: '0x000000000000000000000000000000000000dEaD',
    }
    const out = buildTxReadyFromToolOutput('build_custom_credit_topup', card)
    expect(out).toMatchObject({ chain: 'Polygon', chain_id: '137', tx: { to: ROUTER, value: '0', data: WRAP_DATA } })
  })

  it('build_custom_credit_topup with needs_approval maps to the two-leg approve→main path', () => {
    const ROUTER = '0x1111111111111111111111111111111111111111'
    const card = {
      kind: 'credit_topup',
      chain: 'Polygon',
      chain_id: '137',
      to_address: ROUTER,
      calldata: WRAP_DATA,
      needs_approval: true,
      approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0' },
    }
    const out = buildTxReadyFromToolOutput('build_custom_credit_topup', card)
    expect(out?.approvalTxArgs).toMatchObject({ tx: { to: USDC_E, data: APPROVE_DATA } })
    expect(out?.txArgs).toMatchObject({ tx: { to: ROUTER, data: WRAP_DATA } })
  })

  it('FAILS CLOSED on an unknown-shape flat tool with no usable to/data', () => {
    const card = { kind: 'credit_topup', chain: 'Polygon', chain_id: '137', mystery_field: 'x' }
    expect(buildTxReadyFromToolOutput('build_custom_credit_topup', card)).toBeNull()
  })
})

describe('buildTxReadyFromToolOutput — non-tx envelopes are NEVER signed (the guard)', () => {
  it('rejects setup_trading no_op (no to/data)', () => {
    const noOp = {
      chain: 'Polygon',
      chain_id: '137',
      action: 'no_op',
      approved_spenders: ['CTF Exchange', 'Neg Risk CTF Exchange'],
      message: 'All Polymarket V2 spenders are already approved.',
    }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, noOp)).toBeNull()
  })

  it('rejects deposit insufficient_usdce (no to/data, has error)', () => {
    const insufficient = {
      action: 'insufficient_usdce',
      required: '5.00',
      balance: '1.00',
      error: 'EOA holds 1.00 USDC.e but 5.00 is required.',
    }
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, insufficient)).toBeNull()
  })

  it('rejects an explicit error envelope', () => {
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, { status: 'error', error: 'boom' })).toBeNull()
  })

  it('rejects status:"error" even with a well-formed tx and no top-level error key', () => {
    // isolates the `status === 'error'` branch from the `'error' in env` branch
    const env = { ...setupTradingApprove(), status: 'error' }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects when chain_id is present but chain is absent', () => {
    const env = { chain_id: '137', to: USDC_E, value: '0', data: APPROVE_DATA }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects empty calldata "0x"', () => {
    const env = { ...setupTradingApprove(), data: '0x' }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects odd-length (non-whole-byte) calldata', () => {
    const env = { ...setupTradingApprove(), data: '0x095ea7b3a' } // 9 hex nibbles
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects a non-0x / malformed `to`', () => {
    const env = { ...setupTradingApprove(), to: 'not-an-address' }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects an envelope with neither chain nor chain_id', () => {
    const env = { to: USDC_E, value: '0', data: APPROVE_DATA }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects when chain is present but chain_id is missing', () => {
    const env = { chain: 'Polygon', to: USDC_E, value: '0', data: APPROVE_DATA }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects when chain and chain_id disagree (wrong-chain routing guard)', () => {
    // chain says Polygon but chain_id is Ethereum's — never sign on the wrong chain.
    const env = { ...setupTradingApprove(), chain_id: '1' }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('ACCEPTS a second EVM chain (Ethereum) — proves the chain guard is not hardcoded to Polygon', () => {
    // Generalized past #922's Polygon-only pin: any supported EVM chain whose
    // (chain ⇄ chain_id) agree is accepted. This is the design's "second EVM
    // chain to prove non-hardcoding".
    const env = { ...setupTradingApprove(), chain: 'Ethereum', chain_id: '1' }
    const out = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)
    expect(out).toMatchObject({ chain: 'Ethereum', chain_id: '1', tx: { to: USDC_E, data: APPROVE_DATA } })
  })

  it('rejects a NON-EVM chain (flat enrichment is EVM-only in Phase 1)', () => {
    const env = { ...setupTradingApprove(), chain: 'Bitcoin', chain_id: '0' }
    expect(buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)).toBeNull()
  })

  it('rejects non-object output', () => {
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, null)).toBeNull()
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, undefined)).toBeNull()
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, 'not json')).toBeNull()
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, 42)).toBeNull()
    expect(buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, [setupTradingApprove()])).toBeNull()
  })
})
