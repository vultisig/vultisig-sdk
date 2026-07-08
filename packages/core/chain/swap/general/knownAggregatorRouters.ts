/**
 * Fund-safety allowlist for the general-purpose EVM swap aggregators (AGG-02, round-2
 * spec-level fund-safety audit, 2026-07-08).
 *
 * Each aggregator's quote-construction function (getOneInchSwapQuote.ts, kyber/api/tx.ts,
 * getLifiSwapQuote.ts, getSwapKitQuote.ts) is the TRUST BOUNDARY where an untrusted HTTP
 * response gets parsed into an internal GeneralSwapQuote. That quote's `tx.evm.to` goes on
 * to become BOTH the ERC-20 approval spender (getSwapDestinationAddress ->
 * mpc/keysign/swap/build.ts's allowance check) AND, independently, the actual on-chain swap
 * transaction's destination (build.ts's own txMsg construction -> signingInputs/resolvers/
 * evm/index.ts's WalletCore SigningInput). Two SEPARATE downstream reads of the same field —
 * so validating at either downstream site alone would leave the other unguarded. Validating
 * HERE, at construction, means every consumer (present and future) inherits an
 * already-verified address by construction, instead of needing its own check.
 *
 * 1inch and Kyber can be enforced (fail closed / throw) because their router is a small,
 * stable, deterministically-deployed constant — verified against each provider's OWN live
 * quote API (not just docs/explorers) on Ethereum, Arbitrum, BSC, Base (1inch) and Ethereum,
 * BSC, Arbitrum (Kyber) on 2026-07-08, matching byte-for-byte.
 *
 * LiFi and SwapKit CANNOT be enforced the same way — they route through many different
 * bridge/DEX contracts by design (diamond routing, multi-hop, chain-specific deployments),
 * so a hard allowlist would false-block legitimate routes. Those two are logged (never
 * thrown) via logUnenforcedAggregatorDestination so an anomaly is queryable, and so a future
 * allowlist has real usage data to build from if a pattern emerges.
 */

// 1inch Aggregation Router — V5 (legacy) + V6 (current). Same addresses as the display-only
// registry in chains/evm/contract/knownContracts.ts; kept as an explicit, separate list here
// since THIS one gates signing (throw on mismatch), not just UI labeling — the two lists are
// allowed to drift independently (e.g. a future display-only addition shouldn't silently
// widen what this allowlist accepts).
export const ONE_INCH_ROUTER_ADDRESSES: ReadonlySet<string> = new Set([
  '0x1111111254eeb25477b68fb85ed929f73a960582', // V5
  '0x111111125421ca6dc452d289314280a0f8842a65', // V6 — live-confirmed 2026-07-08 (Ethereum/Arbitrum/BSC/Base)
])

// KyberSwap MetaAggregationRouterV2 — same address on every EVM chain KyberSwap supports
// (deterministic CREATE2 deploy). Live-confirmed 2026-07-08 (Ethereum/BSC/Arbitrum) against
// aggregator-api.kyberswap.com's own /routes response, not just docs/explorers.
export const KYBER_ROUTER_ADDRESSES: ReadonlySet<string> = new Set(['0x6131b5fae19ea4f9d964eac0408e4408b66337b5'])

/** Providers whose router is validated against a fund-safety allowlist (fail closed). */
export const ENFORCED_ROUTER_PROVIDERS = ['1inch', 'kyber'] as const
export type EnforcedRouterProvider = (typeof ENFORCED_ROUTER_PROVIDERS)[number]

const ALLOWLIST_BY_PROVIDER: Record<EnforcedRouterProvider, ReadonlySet<string>> = {
  '1inch': ONE_INCH_ROUTER_ADDRESSES,
  kyber: KYBER_ROUTER_ADDRESSES,
}

/**
 * Throws if `address` isn't the known router for `provider`. Call this at quote construction,
 * before a GeneralSwapQuote carrying `address` as `tx.evm.to` can exist.
 */
export function assertKnownAggregatorRouter(provider: EnforcedRouterProvider, address: string): void {
  if (!ALLOWLIST_BY_PROVIDER[provider].has(address.toLowerCase())) {
    throw new Error(
      `${provider} swap quote returned an unrecognized router address (${address}) — refusing to build a signable transaction against it.`
    )
  }
}

/**
 * Log-only (never throws) — for LiFi/SwapKit, whose legitimate routes span many different
 * contracts. Structured so the data is queryable (provider + address) and a future allowlist
 * is easy to build if a stable pattern emerges from real usage.
 */
export function logUnenforcedAggregatorDestination(provider: 'li.fi' | 'swapkit', address: string): void {
  console.info('[swap-router-telemetry] general-swap destination (not enforced, logged for future analysis):', {
    provider,
    address,
  })
}
