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
 *    Includes the polymarket flat builders (no tx_ready — the sign source) and
 *    the flat produces_calldata tools that DO emit tx_ready (erc20_approve) or a
 *    structurally-unsignable one (build_custom_* — divergent to_address/calldata).
 *  - CLI_PARITY_PREP_TOOLS: execute_* prep tools — PARITY-ONLY in Phase 1
 *    (tx_ready stays authoritative for signing; the prep candidate is compared).
 *
 * Deliberately EXCLUDED from BOTH: EIP-712 tools (polymarket_place_bet,
 * polymarket_setup_deposit_wallet) — signed via the sign_typed_data path.
 */
import { describe, expect, it } from 'vitest'

import {
  CLI_PARITY_PREP_TOOLS,
  CLI_SIGNABLE_FLAT_TOOLS,
  DIVERGENT_FIELD_TOOLS,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '../toolOutputSigning'

describe('CLI_SIGNABLE_FLAT_TOOLS', () => {
  it('contains the polymarket flat builders (no tx_ready — sole sign source)', () => {
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

  it('NEVER includes the execute_* prep tools (those are parity-only)', () => {
    for (const t of CLI_PARITY_PREP_TOOLS) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(false)
    }
  })
})

describe('CLI_PARITY_PREP_TOOLS', () => {
  it('contains exactly the execute_* signer-ready prep tools', () => {
    expect([...CLI_PARITY_PREP_TOOLS].sort()).toEqual(['execute_contract_call', 'execute_send', 'execute_swap'])
  })
})

describe('DIVERGENT_FIELD_TOOLS (to_address/calldata normalization surface)', () => {
  it('is a subset of the flat allowlist (every divergent tool is signable)', () => {
    for (const t of DIVERGENT_FIELD_TOOLS) {
      expect(CLI_SIGNABLE_FLAT_TOOLS.has(t)).toBe(true)
    }
  })
})
