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
  buildTxReadyFromYieldOutput,
  CLI_SIGNABLE_FLAT_TOOLS,
  deriveToolOutputCandidate,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '../../../src/tx/toolOutputSigning'

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
    // execute_* are PREP (their own allowlist), NOT in the flat-enrichment allowlist.
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

describe('deriveToolOutputCandidate — flat vs prep, and the phantom-card guard', () => {
  it('flat signable tool → candidate tagged source:flat', () => {
    const c = deriveToolOutputCandidate(POLYMARKET_SETUP_TRADING_TOOL, setupTradingApprove())
    expect(c?.source).toBe('flat')
    expect(c?.payload).toMatchObject({ tx: { to: USDC_E, data: APPROVE_DATA } })
  })

  it('execute_* prep WITH tx_encoding → candidate tagged source:prep (sign source)', () => {
    const prep = {
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm-tx',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      },
      stepperConfig: {},
    }
    const c = deriveToolOutputCandidate('execute_send', prep)
    expect(c?.source).toBe('prep')
  })

  it('execute_* prep MISSING tx_encoding → null (mirror backend enrichBuildResult phantom-card suppression)', () => {
    const phantom = {
      txArgs: { chain: 'Base', chain_id: '8453', tx: { to: USDC_E, value: '0', data: APPROVE_DATA } },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_send', phantom)).toBeNull()
  })

  it('execute_* prep with empty tx_encoding → null', () => {
    const phantom = {
      txArgs: { chain: 'Base', chain_id: '8453', tx_encoding: '', tx: { to: USDC_E } },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_send', phantom)).toBeNull()
  })

  it('tool outside both allowlists → null', () => {
    expect(deriveToolOutputCandidate('get_balances', { txArgs: { tx_encoding: 'evm-tx' } })).toBeNull()
  })

  it('FAILS CLOSED: prep with DISAGREEING chain⇄chain_id → null (never sign the name chain over the id)', () => {
    // The signer resolves `chain` (name) BEFORE `chain_id`, so chain "Base" +
    // chain_id "1" would silently sign on Base. Reject rather than pick one —
    // parity with the flat path's resolveStrictEvmChain (#927 Phase 2 review).
    const mismatched = {
      txArgs: { chain: 'Base', chain_id: '1', tx_encoding: 'evm', tx: { to: USDC_E, value: '0', data: APPROVE_DATA } },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_send', mismatched)).toBeNull()
  })

  it('FAILS CLOSED: prep with PARENT metadata disagreeing with txArgs → null (never let top-level chain win)', () => {
    // Single-leg prep envelopes are signed using the WHOLE parent payload, and the
    // executor resolves top-level `chain` / `from_chain` / `chain_id` BEFORE
    // `txArgs`. A parent `chain: Ethereum` over `txArgs.chain: Base` would sign the
    // nested tx on the wrong chain unless we reject it here.
    const parentMismatch = {
      chain: 'Ethereum',
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_contract_call', parentMismatch)).toBeNull()
  })

  it('FAILS CLOSED: multi-leg prep whose approval leg is SELF-CONFLICTING → null (never sign the approval on the wrong chain)', () => {
    // rcoderdev #1003 review: a multi-leg prep envelope's `approvalTxArgs` carries its
    // own chain metadata. The executor resolves that leg's `chain` (name) BEFORE
    // `chain_id`, so `chain: Base` + `chain_id: 1` resolves to Base and can pass the
    // approval⇄main comparison (main is also Base) even though the leg's own metadata
    // disagrees — signing the APPROVAL tx on the wrong chain. Reject it.
    const approvalSelfConflict = {
      chain: 'Base',
      chain_id: '8453',
      approvalTxArgs: {
        chain: 'Base',
        chain_id: '1', // disagrees with its own `chain: Base` (8453)
        tx_encoding: 'evm',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      },
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm',
        tx: { to: ONRAMP, value: '0', data: WRAP_DATA },
      },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_swap', approvalSelfConflict)).toBeNull()
  })

  it('FAILS CLOSED: multi-leg prep whose approval leg is a DIFFERENT chain than the main leg → null', () => {
    // A self-consistent but cross-chain approval leg (Ethereum) against a Base main
    // leg must not derive — the approval would sign on a chain the main tx never uses.
    const approvalCrossChain = {
      chain: 'Base',
      chain_id: '8453',
      approvalTxArgs: {
        chain: 'Ethereum',
        chain_id: '1',
        tx_encoding: 'evm',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      },
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm',
        tx: { to: ONRAMP, value: '0', data: WRAP_DATA },
      },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_swap', approvalCrossChain)).toBeNull()
  })

  it('accepts multi-leg prep whose approval leg matches the main prep chain', () => {
    // The happy path the guard must not over-reject: approval + main both on Base.
    const consistent = {
      chain: 'Base',
      chain_id: '8453',
      approvalTxArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      },
      txArgs: {
        chain: 'Base',
        chain_id: '8453',
        tx_encoding: 'evm',
        tx: { to: ONRAMP, value: '0', data: WRAP_DATA },
      },
      stepperConfig: {},
    }
    const c = deriveToolOutputCandidate('execute_swap', consistent)
    expect(c?.source).toBe('prep')
  })

  it('FAILS CLOSED: prep with NO resolvable chain → null (never default to Ethereum at sign time)', () => {
    // A single-leg prep envelope whose txArgs carries no chain/chain_id would let
    // the executor default to Chain.Ethereum and broadcast on the wrong chain.
    const chainless = {
      txArgs: { tx_encoding: 'evm', tx: { to: USDC_E, value: '0', data: APPROVE_DATA } },
      stepperConfig: {},
    }
    expect(deriveToolOutputCandidate('execute_send', chainless)).toBeNull()
  })

  it('accepts prep resolvable by chain NAME alone (non-EVM: chain_id absent) — not EVM-only', () => {
    // Non-EVM sends (Cosmos/Solana) may omit a resolvable numeric chain_id; a chain
    // that resolves by NAME alone is accepted (only a present-and-disagreeing pair,
    // or total non-resolution, fails closed).
    const cosmos = {
      txArgs: { chain: 'THORChain', tx_encoding: 'cosmos', to: 'thor1xyz', amount: '1' },
      stepperConfig: {},
    }
    const c = deriveToolOutputCandidate('execute_send', cosmos)
    expect(c?.source).toBe('prep')
  })
})

// ============================================================================
// yield_enter / yield_exit — the top-level transactions[] (Pattern 2) shape.
// Bead vultisig-6rg2: these were in NEITHER allowlist, so deriveToolOutputCandidate
// returned null → no synthetic sign_tx → keysign never fired on yield deposits.
// ============================================================================

const AAVE_POOL = '0x794a61358d6845594f94dc1db02a252b5b4814ad'
const YIELD_DEPOSIT_DATA = '0x617ba037' + '0'.repeat(248)

/** A realistic EVM yield_enter output: approve USDC → deposit into Aave Pool.
 *  Mirrors mcp-lunc-hop yield-tools.ts parseActionDisplay EVM canonical steps. */
function yieldEnterApproveDeposit() {
  return {
    scan_request: { kind: 'evm', chain: 'polygon' },
    intent: 'enter',
    type: 'lending',
    yieldId: 'polygon-usdc-aave-v3-lending',
    amount: '0.4',
    amountUsd: '0.4',
    chain: 'Polygon',
    provider: 'yield_xyz',
    transactions: [
      { to: USDC_E, value: '0x0', data: APPROVE_DATA, action: 'approval', description: 'Approve USDC' },
      { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA, action: 'deposit', description: 'Deposit into Aave v3' },
    ],
  }
}

/** A single-step EVM yield action (e.g. a withdraw, or a deposit whose allowance
 *  is already sufficient). */
function yieldSingleStep() {
  return {
    scan_request: { kind: 'evm', chain: 'polygon' },
    intent: 'exit',
    type: 'lending',
    yieldId: 'polygon-usdc-aave-v3-lending',
    amount: '0.4',
    chain: 'Polygon',
    provider: 'yield_xyz',
    transactions: [
      {
        to: AAVE_POOL,
        value: '0x0',
        data: YIELD_DEPOSIT_DATA,
        action: 'withdraw',
        description: 'Withdraw from Aave v3',
      },
    ],
  }
}

describe('buildTxReadyFromYieldOutput — allowlist gate', () => {
  it('returns null for a non-yield tool (never enriches an unlisted tool)', () => {
    expect(buildTxReadyFromYieldOutput('execute_send', yieldEnterApproveDeposit())).toBeNull()
    expect(buildTxReadyFromYieldOutput(POLYMARKET_DEPOSIT_TOOL, yieldEnterApproveDeposit())).toBeNull()
  })
})

describe('buildTxReadyFromYieldOutput — 2-step approve+deposit → multi-leg', () => {
  it('maps transactions[approve,deposit] onto approvalTxArgs/txArgs with nested tx', () => {
    const out = buildTxReadyFromYieldOutput('yield_enter', yieldEnterApproveDeposit())
    expect(out).not.toBeNull()
    expect(out).toMatchObject({
      chain: 'Polygon',
      approvalTxArgs: { chain: 'Polygon', tx: { to: USDC_E, value: '0x0', data: APPROVE_DATA } },
      txArgs: { chain: 'Polygon', tx: { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA } },
    })
    // approve leg is FIRST (signed + receipt-confirmed before the deposit).
    expect(out?.approvalTxArgs).toBeDefined()
    // a multi-leg envelope must NOT also carry a single-leg `tx`.
    expect(out?.tx).toBeUndefined()
  })

  it('faithfully copies the backend-built calldata verbatim (never fabricates)', () => {
    const out = buildTxReadyFromYieldOutput('yield_enter', yieldEnterApproveDeposit())
    // the deposit selector (0x617ba037 = Aave supply) survives untouched.
    expect((out?.txArgs as { tx: { data: string } }).tx.data).toBe(YIELD_DEPOSIT_DATA)
    expect((out?.approvalTxArgs as { tx: { data: string } }).tx.data).toBe(APPROVE_DATA)
  })
})

describe('buildTxReadyFromYieldOutput — single-step → single-leg', () => {
  it('maps a lone transactions[action] onto {chain,tx}', () => {
    const out = buildTxReadyFromYieldOutput('yield_exit', yieldSingleStep())
    expect(out).toMatchObject({ chain: 'Polygon', tx: { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA } })
    expect(out?.approvalTxArgs).toBeUndefined()
  })
})

describe('buildTxReadyFromYieldOutput — fail-closed guards (never sign a bad shape)', () => {
  it('null when transactions[] is absent', () => {
    const { transactions: _drop, ...noTxs } = yieldEnterApproveDeposit()
    void _drop
    expect(buildTxReadyFromYieldOutput('yield_enter', noTxs)).toBeNull()
  })

  it('null when transactions[] is empty', () => {
    expect(buildTxReadyFromYieldOutput('yield_enter', { ...yieldEnterApproveDeposit(), transactions: [] })).toBeNull()
  })

  it('null when the envelope is an error', () => {
    expect(buildTxReadyFromYieldOutput('yield_enter', { ...yieldEnterApproveDeposit(), status: 'error' })).toBeNull()
    expect(buildTxReadyFromYieldOutput('yield_enter', { error: 'yield.xyz rejected' })).toBeNull()
  })

  it('null when chain is missing (would default to Ethereum at sign time)', () => {
    const { chain: _drop, ...noChain } = yieldEnterApproveDeposit()
    void _drop
    expect(buildTxReadyFromYieldOutput('yield_enter', noChain)).toBeNull()
  })

  it('null for a non-EVM chain (yield multi-step signing is EVM-only here)', () => {
    // A Solana yield envelope (its steps carry tx_encoding: solana-tx and a raw
    // data string, not flat to/data) must NOT be forced through the EVM legs.
    const solana = {
      ...yieldEnterApproveDeposit(),
      chain: 'Solana',
      transactions: [{ tx_encoding: 'solana-tx', chain: 'Solana', data: 'base64blob', action: 'deposit' }],
    }
    expect(buildTxReadyFromYieldOutput('yield_enter', solana)).toBeNull()
  })

  it('null when ANY leg is un-liftable (all-or-nothing: never a partial sequence)', () => {
    const badDeposit = {
      ...yieldEnterApproveDeposit(),
      transactions: [
        { to: USDC_E, value: '0x0', data: APPROVE_DATA, action: 'approval' },
        { to: AAVE_POOL, value: '0x0', action: 'deposit' }, // no calldata
      ],
    }
    expect(buildTxReadyFromYieldOutput('yield_enter', badDeposit)).toBeNull()
  })

  it('null when a leg carries an error marker', () => {
    const errLeg = {
      ...yieldEnterApproveDeposit(),
      transactions: [
        { to: USDC_E, value: '0x0', data: APPROVE_DATA, action: 'approval' },
        { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA, action: 'deposit', error: 'sim failed' },
      ],
    }
    expect(buildTxReadyFromYieldOutput('yield_enter', errLeg)).toBeNull()
  })

  it('null for a >2-leg envelope (executor 2-leg sequencer cannot represent it — fail closed)', () => {
    const threeLegs = {
      ...yieldEnterApproveDeposit(),
      transactions: [
        { to: USDC_E, value: '0x0', data: APPROVE_DATA, action: 'approval' },
        { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA, action: 'deposit' },
        { to: AAVE_POOL, value: '0x0', data: YIELD_DEPOSIT_DATA, action: 'stake' },
      ],
    }
    expect(buildTxReadyFromYieldOutput('yield_enter', threeLegs)).toBeNull()
  })
})

describe('deriveToolOutputCandidate — yield tools (bead vultisig-6rg2, the regression)', () => {
  it('yield_enter approve+deposit → candidate tagged source:yield (WAS null pre-fix)', () => {
    const c = deriveToolOutputCandidate('yield_enter', yieldEnterApproveDeposit())
    expect(c?.source).toBe('yield')
    expect(c?.payload).toMatchObject({
      approvalTxArgs: { tx: { to: USDC_E, data: APPROVE_DATA } },
      txArgs: { tx: { to: AAVE_POOL, data: YIELD_DEPOSIT_DATA } },
    })
  })

  it('yield_exit single-step → candidate tagged source:yield', () => {
    const c = deriveToolOutputCandidate('yield_exit', yieldSingleStep())
    expect(c?.source).toBe('yield')
    expect(c?.payload).toMatchObject({ tx: { to: AAVE_POOL, data: YIELD_DEPOSIT_DATA } })
  })

  it('CONTROL: a yield tool with no signable tx → null (nothing signs)', () => {
    expect(deriveToolOutputCandidate('yield_enter', { chain: 'Polygon', transactions: [] })).toBeNull()
  })
})
