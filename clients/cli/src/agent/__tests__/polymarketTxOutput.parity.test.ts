/**
 * Parity guard: the CLI's flat-tx-builder allowlist vs the mcp-ts source of truth.
 *
 * The CLI signs Polymarket flat-tx-builder outputs the way the mobile app does
 * (mobile routes them via `BUILD_TX_EXACT_TOOLS`). To stop the CLI allowlist
 * from silently drifting from mcp-ts, this test mirrors the mcp-ts m7 contract
 * list and pins the DOCUMENTED relationship between the two.
 *
 * The two sets are deliberately NOT identical, for two concrete reasons:
 *
 *  1. `polymarket_place_bet` is in the m7 list but is an EIP-712 *off-chain
 *     signature* (a CTF-Exchange order + CLOB auth challenge), NOT flat EVM
 *     calldata. It is signed via a different path and MUST stay out of the
 *     CLI's flat-calldata allowlist.
 *
 *  2. `polymarket_deposit` is flat EVM calldata (USDC.e approve + wrap) and is
 *     the primary multi-step signing case, but it is ABSENT from the m7 list
 *     (m7 enumerates off-chain-signable tools; deposit emits ordinary on-chain
 *     txs). It MUST be in the CLI allowlist.
 *
 * So:  CLI_BUILD_TX_TOOL_NAMES  ==  (m7 OFF_CHAIN_SIGNABLE − place_bet) + deposit
 *
 * This is a MIRROR, not a cross-repo import (mcp-ts is a separate repo). If
 * mcp-ts changes its m7 list, sync `MCP_TS_OFF_CHAIN_SIGNABLE_TOOL_NAMES` below
 * and re-derive — this test then forces a conscious reconciliation instead of a
 * silent divergence. Source of truth:
 *   mcp-ts src/lib/__tests__/m7_contract.test.ts  (OFF_CHAIN_SIGNABLE_TOOL_NAMES)
 *   mcp-ts src/tools/polymarket/polymarket-tools.ts (BUILD_TX_EXACT_TOOLS routing)
 */
import { describe, expect, it } from 'vitest'

import { CLI_BUILD_TX_TOOL_NAMES } from '../polymarketTxOutput'

/**
 * Verbatim mirror of mcp-ts `m7_contract.test.ts` OFF_CHAIN_SIGNABLE_TOOL_NAMES
 * (commit-pinned by review). Keep this in sync by hand; the assertions below
 * break loudly if the derived CLI set no longer matches.
 */
const MCP_TS_OFF_CHAIN_SIGNABLE_TOOL_NAMES = ['polymarket_place_bet', 'polymarket_setup_trading'] as const

/** m7 tools that sign EIP-712 / off-chain payloads, NOT flat EVM calldata. */
const EIP712_OFFCHAIN_ONLY = new Set<string>(['polymarket_place_bet'])

/** Flat-calldata builders that emit ordinary on-chain txs and are (correctly)
 *  absent from the off-chain-signable m7 list, but must still be CLI-signable. */
const FLAT_CALLDATA_NOT_IN_M7 = ['polymarket_deposit'] as const

describe('CLI_BUILD_TX_TOOL_NAMES parity with mcp-ts m7', () => {
  it('equals (m7 off-chain-signable − EIP-712-only) + flat-calldata-not-in-m7', () => {
    const expected = new Set<string>([
      ...MCP_TS_OFF_CHAIN_SIGNABLE_TOOL_NAMES.filter(name => !EIP712_OFFCHAIN_ONLY.has(name)),
      ...FLAT_CALLDATA_NOT_IN_M7,
    ])
    expect(new Set(CLI_BUILD_TX_TOOL_NAMES)).toEqual(expected)
  })

  it('NEVER includes polymarket_place_bet (EIP-712 off-chain, not flat calldata)', () => {
    expect(CLI_BUILD_TX_TOOL_NAMES.has('polymarket_place_bet')).toBe(false)
  })

  it('NEVER includes polymarket_setup_deposit_wallet (EIP-712 Batch via sign_typed_data)', () => {
    expect(CLI_BUILD_TX_TOOL_NAMES.has('polymarket_setup_deposit_wallet')).toBe(false)
  })

  it('includes both flat-calldata builders (deposit + setup_trading)', () => {
    expect(CLI_BUILD_TX_TOOL_NAMES.has('polymarket_deposit')).toBe(true)
    expect(CLI_BUILD_TX_TOOL_NAMES.has('polymarket_setup_trading')).toBe(true)
  })
})
