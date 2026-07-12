/**
 * Allowlist contract for the client-side tool-output signing layer.
 *
 * The CLI holds NO tools/list cache, so `produces_calldata` (a tool-DEFINITION
 * `_meta` flag) is unavailable at runtime. Signable detection is therefore a
 * NAME ALLOWLIST — the same mechanism mobile's `BUILD_TX_EXACT_TOOLS` and #922
 * use. This test pins the two buckets and the documented exclusions so the
 * allowlist can't silently drift.
 *
 *  - CLI_SIGNABLE_FLAT_TOOLS: flat-output tools the CLI ENRICHES client-side.
 *    Includes the polymarket flat builders and the flat produces_calldata tools
 *    (erc20_approve, build_custom_* — divergent to_address/calldata).
 *  - CLI_SIGNABLE_PREP_TOOLS: execute_* prep tools — #927 Phase 2 signs these
 *    from tool-output (the payload rides tool-output-available).
 *
 * Deliberately EXCLUDED from BOTH: EIP-712 tools (polymarket_place_bet,
 * polymarket_setup_deposit_wallet) — signed via the sign_typed_data path.
 */
import { describe, expect, it } from 'vitest'

import {
  CLI_SIGNABLE_FLAT_TOOLS,
  CLI_SIGNABLE_PREP_TOOLS,
  DIVERGENT_FIELD_TOOLS,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '../toolOutputSigning'

describe('CLI_SIGNABLE_FLAT_TOOLS', () => {
  it('contains the polymarket flat builders (their calldata rides tool-output)', () => {
    expect(CLI_SIGNABLE_FLAT_TOOLS.has(POLYMARKET_DEPOSIT_TOOL)).toBe(true)
    expect(CLI_SIGNABLE_FLAT_TOOLS.has(POLYMARKET_SETUP_TRADING_TOOL)).toBe(true)
  })

  it('contains the flat produces_calldata tools (erc20_approve + the payments cards)', () => {
    for (const t of [
      'erc20_approve',
      'build_custom_credit_topup',
      'build_credit_pack_topup',
      'build_max_subscription_renewal',
      'build_pro_subscription_renewal',
    ]) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(true)
    }
  })

  it('NEVER includes EIP-712 / typed-data tools', () => {
    expect(CLI_SIGNABLE_FLAT_TOOLS.has('polymarket_place_bet')).toBe(false)
    expect(CLI_SIGNABLE_FLAT_TOOLS.has('polymarket_setup_deposit_wallet')).toBe(false)
  })

  it('NEVER includes the execute_* prep tools (those are the prep allowlist)', () => {
    for (const t of CLI_SIGNABLE_PREP_TOOLS) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(false)
    }
  })
})

describe('CLI_SIGNABLE_FLAT_TOOLS — independent anchor vs the mcp-ts source of truth', () => {
  // Hand-mirrored from the mcp-ts sources (mcp-ts is a separate repo — this is a
  // MIRROR, not an import; keep it in sync by hand so a drift forces a conscious
  // reconciliation instead of a silent divergence). Sources:
  //   evm/erc20-approve.ts:145 (producesCalldata: true) → flat {chain,chain_id,to,value,data}
  //   payments/build-custom-credit-topup.ts:86, build-credit-pack-topup.ts:98,
  //   build-max-subscription-renewal.ts:72, build-pro-subscription-renewal.ts:72
  //     (producesCalldata: true; DIVERGENT to_address/calldata card shape)
  // Flat produces_calldata tools, enriched + signed by the CLI off tool-output:
  const MCP_TS_FLAT_PRODUCES_CALLDATA = [
    'erc20_approve',
    'build_custom_credit_topup',
    'build_credit_pack_topup',
    'build_max_subscription_renewal',
    'build_pro_subscription_renewal',
  ] as const
  // BUILD_TX_EXACT flat builders that set NO producesCalldata (no tx_ready) — the CLI is their
  // ONLY signer. Sources: polymarket/polymarket-tools.ts (setup_trading:1371, deposit:1872).
  const MCP_TS_FLAT_NO_TX_READY = [POLYMARKET_DEPOSIT_TOOL, POLYMARKET_SETUP_TRADING_TOOL] as const

  it('equals exactly (mcp-ts flat produces_calldata) ∪ (BUILD_TX_EXACT flat no-tx_ready)', () => {
    const expected = new Set<string>([...MCP_TS_FLAT_PRODUCES_CALLDATA, ...MCP_TS_FLAT_NO_TX_READY])
    expect(new Set(CLI_SIGNABLE_FLAT_TOOLS)).toEqual(expected)
  })
})

describe('CLI_SIGNABLE_PREP_TOOLS', () => {
  it('contains exactly the execute_* signer-ready prep tools', () => {
    expect([...CLI_SIGNABLE_PREP_TOOLS].sort()).toEqual(['execute_contract_call', 'execute_send', 'execute_swap'])
  })
})

describe('DIVERGENT_FIELD_TOOLS (to_address/calldata normalization surface)', () => {
  it('is a subset of the flat allowlist (every divergent tool is signable)', () => {
    for (const t of DIVERGENT_FIELD_TOOLS) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(true)
    }
  })
})
