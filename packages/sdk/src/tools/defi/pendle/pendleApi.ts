// Pendle Finance Hosted SDK client (REST wrapper).
//
// The lib-vs-handroll deep-dive verdict for Pendle is WRAP the hosted REST API:
// the npm SDK (@pendle/core-v2) pins ethers 5.7 Solidity helpers (RN/Hermes
// kill-filter fail) and the router curve math is too gnarly to hand-roll. The
// Hosted SDK's Convert endpoint returns ready-to-broadcast router calldata for
// PT buy/sell/redeem, so we never hand-encode the Pendle Router — we just emit
// the unsigned tx it hands back.
//
// This module BUILDS UNSIGNED calldata only. It never signs, never broadcasts.
//
// Docs: https://docs.pendle.finance/Developers/Backend/BackendAndHostedSDK
// API:  https://api-v2.pendle.finance/core  (verified live)
//
// Ported from mcp-ts src/lib/pendle-api.ts. RN-safe: uses queryUrl (the SDK's
// fetch primitive) — no ethers, no node:crypto, no WASM.

import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

export const PENDLE_API_BASE = 'https://api-v2.pendle.finance/core'

// Router V4 — the same CREATE2-deterministic address on every chain. Pendle's
// Convert response returns this as tx.to; builders sanity-assert against it.
export const PENDLE_ROUTER_V4 = '0x888888888889758F76e7103c6CbF23ABbF58F946'

// Chains we expose Pendle on: those the SDK already has full EVM chain support
// for AND that Pendle is deployed on. Pendle is also on Sonic/Berachain/
// HyperEVM/Monad — deferred until those have first-class SDK support.
export const PENDLE_SUPPORTED_CHAINS = [
  EvmChain.Ethereum,
  EvmChain.Arbitrum,
  EvmChain.Optimism,
  EvmChain.BSC,
  EvmChain.Mantle,
  EvmChain.Base,
] as const
export type PendleChain = (typeof PENDLE_SUPPORTED_CHAINS)[number]

export function isPendleChain(chain: string): chain is PendleChain {
  return (PENDLE_SUPPORTED_CHAINS as readonly string[]).includes(chain)
}

// Numeric EVM chain id for the Pendle REST path, derived from core's chain
// registry (hex) — never hardcoded.
export function pendleChainId(chain: PendleChain): number {
  return hexToNumber(getEvmChainId(chain as EvmChain))
}

// The markets endpoints return token addresses PREFIXED with the chain id
// ("1-0xabc…"). Strip the "{chainId}-" so the bare 0x address is usable
// on-chain and in Convert calls. Easy-to-miss integration bug.
export function stripChainPrefix(addr: string | undefined | null): string {
  if (!addr) return ''
  const dash = addr.indexOf('-')
  // Only strip when the segment before '-' is all digits (a chain id) and an
  // 0x address follows — never mangle a bare address that happens to contain '-'.
  if (dash > 0 && /^\d+$/.test(addr.slice(0, dash)) && addr.slice(dash + 1).startsWith('0x')) {
    return addr.slice(dash + 1)
  }
  return addr
}

// --- response shapes (only the fields we surface) ---

export type PendleActiveMarket = {
  name: string
  address: string
  expiry: string
  pt: string
  yt: string
  sy: string
  underlyingAsset: string
  details?: {
    liquidity?: number
    impliedApy?: number // PT fixed yield
    underlyingApy?: number // raw yield of the underlying
    pendleApy?: number
    aggregatedApy?: number
    maxBoostedApy?: number
    feeRate?: number
    yieldRange?: { min: number; max: number } // YT exposure band
  }
  isPrime?: boolean
  categoryIds?: string[]
}

type ActiveMarketsResponse = {
  markets: PendleActiveMarket[]
}

/**
 * Active (non-expired) Pendle markets for a chain.
 * GET /v1/{chainId}/markets/active
 * Token addresses are returned chain-id-prefixed; callers should pass each
 * through stripChainPrefix before on-chain use (the builders do this).
 */
export async function pendleActiveMarkets(chain: PendleChain): Promise<PendleActiveMarket[]> {
  const chainId = pendleChainId(chain)
  const url = `${PENDLE_API_BASE}/v1/${chainId}/markets/active`
  const res = await queryUrl<ActiveMarketsResponse>(url)
  return res.markets ?? []
}

// --- Convert API (swap/mint/redeem tx build) ---

export type PendleConvertRoute = {
  tx: { to: string; data: string; from?: string; value?: string }
  outputs?: { token: string; amount: string }[]
  data?: {
    priceImpact?: number
    impliedApy?: { before?: number; after?: number }
    fee?: { usd?: number }
  }
  contractParamInfo?: { method?: string }
}

export type PendleConvertResponse = {
  action?: string
  // ERC20 allowances the Router (tx.to) needs before the main tx. Empty for
  // native-token input.
  requiredApprovals?: { token: string; amount: string }[]
  routes?: PendleConvertRoute[]
}

export type PendleConvertArgs = {
  chainId: number
  tokensIn: string
  amountsIn: string // wei of the token's OWN decimals
  tokensOut: string
  receiver: string
  slippage: number // 0–1 (0.01 = 1%)
  enableAggregator?: boolean
  /**
   * Optional affiliate / fee-recipient address. INJECTABLE by the consumer —
   * the SDK is multi-consumer and NEVER hardcodes an affiliate. Defaults to
   * off (neutral): when omitted, no aggregator-referral param is sent.
   */
  aggregatorReceiver?: string
}

/**
 * Pendle Hosted SDK Convert: returns ready-to-broadcast router calldata for a
 * swap/mint/redeem, plus the exact ERC20 approvals the Router needs.
 * GET /v2/sdk/{chainId}/convert
 *
 * IMPORTANT (verified live):
 *  - amounts are wei of the token's OWN decimals (e.g. an 18-dec token is 18,
 *    USDC is 6).
 *  - there is a min-valuation floor (~$0.01); tiny amounts 400 with
 *    "input valuation is too low".
 *  - tx.value is ABSENT for ERC20 input (treat as '0'); present (>0) only for
 *    native ETH input.
 *  - tx.to is always Router V4 (PENDLE_ROUTER_V4).
 *
 * BUILDS UNSIGNED calldata only — never signs, never broadcasts.
 */
export async function pendleConvert(args: PendleConvertArgs): Promise<PendleConvertResponse> {
  const params: Record<string, string> = {
    receiver: args.receiver,
    slippage: String(args.slippage),
    tokensIn: args.tokensIn,
    amountsIn: args.amountsIn,
    tokensOut: args.tokensOut,
    enableAggregator: String(args.enableAggregator ?? true),
    additionalData: 'impliedApy',
  }
  // Affiliate stays OFF unless the consumer injects one (multi-consumer SDK).
  if (args.aggregatorReceiver) {
    params.aggregatorReceiver = args.aggregatorReceiver
  }
  const q = new URLSearchParams(params)
  const url = `${PENDLE_API_BASE}/v2/sdk/${args.chainId}/convert?${q.toString()}`
  return queryUrl<PendleConvertResponse>(url)
}

const MAX_UINT256 = (1n << 256n) - 1n

// Minimal ERC20 approve(spender, amount) calldata. selector 0x095ea7b3 +
// 32-byte spender (left-padded) + 32-byte amount. Avoids pulling in an ABI
// encoder — the only contract call this module hand-encodes (the Router call
// itself comes pre-encoded from Convert).
//
// Fund-safety: this hand-builds signable calldata, so it MUST refuse anything
// it can't faithfully encode into the fixed 4+32+32 byte layout — silently
// emitting a 65-byte word or a `-1` amount would hand the signer calldata that
// does NOT match the reported value. We therefore:
//  - require `spender` to be a syntactic 0x-prefixed 20-byte address (the only
//    caller passes the fixed Router V4, but the helper is exported), and
//  - require `amount` to be a plain decimal string in [0, 2^256-1] (no hex/
//    octal injection via BigInt's `0x`/`0o` parsing, no negatives, no overflow).
export function encodeErc20Approve(spender: string, amount: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) {
    throw new Error(`encodeErc20Approve: invalid spender address ${spender}`)
  }
  // Decimal-only: blocks BigInt('0x..')/('0o..') injection + whitespace/sign tricks.
  if (!/^\d+$/.test(amount)) {
    throw new Error(`encodeErc20Approve: amount must be a non-negative base-10 integer, got ${amount}`)
  }
  const value = BigInt(amount)
  if (value > MAX_UINT256) {
    throw new Error(`encodeErc20Approve: amount ${amount} exceeds uint256 max`)
  }
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  const amt = value.toString(16).padStart(64, '0')
  return '0x095ea7b3' + addr + amt
}
