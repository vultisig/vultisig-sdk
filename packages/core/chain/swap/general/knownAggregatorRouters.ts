import { Chain } from '../../Chain'

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
 * stable, deterministically-deployed constant on almost every chain — verified against each
 * provider's OWN live quote API (not just docs/explorers), chain by chain, on 2026-07-08.
 *
 * CHAIN-SCOPING MATTERS (codex review, PR #1079): 1inch's V6 router is NOT the same address
 * on zkSync Era — confirmed live (a real 200 response from a real quote request returned a
 * DIFFERENT contract there). This is exactly the caveat chains/evm/contract/knownContracts.ts
 * already documents for 1inch V5 ("not zkSync Era — different V5 router"); it turns out to
 * also hold for V6. A flat, chain-agnostic allowlist would have hard-blocked every legitimate
 * zkSync 1inch swap. Kyber showed no such variance on every chain that returned a live
 * response (see the per-chain notes below) — its allowlist stays flat.
 *
 * LiFi and SwapKit CANNOT be enforced the same way — they route through many different
 * bridge/DEX contracts by design (diamond routing, multi-hop, chain-specific deployments),
 * so a hard allowlist would false-block legitimate routes. Those two are logged (never
 * thrown) via logUnenforcedAggregatorDestination so an anomaly is queryable, and so a future
 * allowlist has real usage data to build from if a pattern emerges.
 */

// 1inch Aggregation Router V5 (legacy). Same address as
// chains/evm/contract/knownContracts.ts's display-only registry; kept separate here since
// THIS one gates signing, not just UI labeling. NOTE: the implementation below only accepts
// this on non-zkSync chains (same exclusive branch as V6) — getOneInchSwapQuote.ts only
// calls the v6.0 API today, so a V5 address is never actually seen through this path
// regardless; harmless defense-in-depth either way.
const ONE_INCH_V5_ROUTER = '0x1111111254eeb25477b68fb85ed929f73a960582'

// V6's standard address — live-confirmed 2026-07-08 on Ethereum, Arbitrum, BSC, Base,
// Optimism, Avalanche, Polygon (7 of 8 oneInchSwapEnabledChains chains).
const ONE_INCH_V6_STANDARD_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'

// V6 on zkSync Era ONLY — live-confirmed 2026-07-08 via a real api.vultisig.com/1inch
// v6.0 quote request returning this address (NOT the standard one above).
const ONE_INCH_V6_ZKSYNC_ROUTER = '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff'

// KyberSwap MetaAggregationRouterV2 — same address confirmed live 2026-07-08 on every
// kyberSwapEnabledChains chain through aggregator-api.kyberswap.com's /routes
// (Ethereum, BSC, Arbitrum, Optimism, Avalanche, Base, Polygon).
const KYBER_STANDARD_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'

export type EnforcedRouterProvider = '1inch' | 'kyber'

const ENFORCED_ROUTER_PROVIDERS: ReadonlySet<string> = new Set<EnforcedRouterProvider>(['1inch', 'kyber'])

/**
 * Signing-path re-assert (sdk#1358): the same allow-list check as {@link assertKnownAggregatorRouter},
 * but keyed off an arbitrary provider STRING (the value carried in KeysignSwapPayload.general.provider,
 * which is a plain `string`). Enforced providers (1inch/kyber) fail closed; unenforced providers
 * (li.fi/swapkit/cowswap) fall through to the same log-only path they take at quote construction.
 *
 * WHY THIS EXISTS SEPARATELY FROM quote construction: a compromised initiator (or server composing the
 * intent) can hand a co-signer a KeysignPayload whose swapPayload.quote.tx.to was NEVER run through the
 * quote-time check - every co-signer independently rebuilds the signing input from that payload, so the
 * guard has to run HERE too, on the signing-input path, or a co-signer (e.g. VultiServer in a 2-of-2)
 * signs a destination it never validated. Mirrors the Ripple resolver's in-resolver fail-closed binding.
 *
 * THREAT MODEL / TRUST OF `provider` (CodeRabbit security review): `provider` here is the free `provider`
 * STRING on the OneInchSwapPayload proto (the `oneinchSwapPayload` oneof case carries 1inch/li.fi/cowswap
 * with only this string to tell them apart; swapkit is the one general provider derived from its own
 * oneof case). It is therefore part of the attacker-influenceable payload, NOT a trusted oneof discriminant.
 * That is acceptable because this guard is MONOTONIC: it only ever THROWS (rejects) or no-ops - it never
 * makes anything signable that wasn't already. So an attacker who spoofs `provider` to an UNENFORCED value
 * (e.g. 'li.fi') to skip enforcement merely degrades this to the pre-#1358 state (no signing-path guard) -
 * it is NOT a new bypass, and it cannot be used to sign a payload that was unsignable before. What the guard
 * DOES buy is defense-in-depth against the realistic partial compromise the issue targets: a quote
 * server/MITM that swaps tx.to but leaves an honestly-declared enforced provider intact - the co-signer now
 * catches it. Complete co-signer protection for arbitrary-router providers (li.fi/swapkit route through many
 * contracts BY DESIGN and cannot be allow-listed - see assertKnownAggregatorRouter's own note) is a larger,
 * separate problem that predates this fix and would need a proto change (a distinct oneof case per provider)
 * to key enforcement on the case rather than the string. Out of scope here; not a regression introduced here.
 */
export function assertKnownAggregatorRouterOnSigningPath(provider: string, address: string, chain: Chain): void {
  if (ENFORCED_ROUTER_PROVIDERS.has(provider)) {
    // assertKnownAggregatorRouter fails closed on an unrecognized address, INCLUDING an empty/missing
    // one - an enforced-provider swap with no destination is itself a malformed intent we won't sign.
    assertKnownAggregatorRouter(provider as EnforcedRouterProvider, address, chain)
    return
  }
  // Unenforced (li.fi/swapkit/cowswap): log-only, and log the ACTUAL provider so the usage dataset the
  // future allow-list is built from isn't poisoned by a coerced label. Skip a genuinely empty address.
  if (address) {
    logUnenforcedAggregatorDestination(provider, address)
  }
}

/**
 * Signing-path approval-spender bind (sdk#1358 review follow-up, requested by neavra). The
 * follow-on to {@link assertKnownAggregatorRouterOnSigningPath}: that guard validates the swap-leg
 * destination (`quote.tx.to`), but a general swap that needs an allowance also carries a SEPARATE,
 * independent wire field - `erc20ApprovePayload.spender` - which the approve resolver (erc20.ts)
 * reads verbatim and nothing binds to `quote.tx.to`. So a payload can pass the router check with a
 * genuine 1inch/kyber `tx.to` yet still carry an approve granting an ATTACKER an allowance over the
 * user's token (a classic approval-drain the co-signer would otherwise sign blind).
 *
 * On the initiator these coincide by construction (build.ts sets the approve spender to
 * `getSwapDestinationAddress` === `tx.to`), so this only ever fires on a hand-built/tampered payload.
 * Enforced providers (1inch/kyber) MUST have `spender === routerDestination`; unenforced providers are
 * NOT bound - notably cowswap, whose spender is legitimately the GPv2VaultRelayer, not `tx.to`. Like
 * its sibling this is a MONOTONIC gate: it only throws or no-ops, never changes the signed bytes.
 */
export function assertEnforcedSwapApprovalSpenderBound(
  provider: string,
  spender: string,
  routerDestination: string,
  chain: Chain
): void {
  if (!ENFORCED_ROUTER_PROVIDERS.has(provider)) {
    return
  }
  if (spender.toLowerCase() !== routerDestination.toLowerCase()) {
    throw new Error(
      `${provider} swap approval spender (${spender}) does not match the verified swap router (${routerDestination}) on ${chain} — refusing to sign an approval to an unbound spender.`
    )
  }
}

/**
 * Throws if `address` isn't the known router for `provider` on `chain`. Call this at quote
 * construction, before a GeneralSwapQuote carrying `address` as `tx.evm.to` can exist.
 */
export function assertKnownAggregatorRouter(provider: EnforcedRouterProvider, address: string, chain: Chain): void {
  const normalized = address.toLowerCase()
  const isKnown =
    provider === 'kyber'
      ? normalized === KYBER_STANDARD_ROUTER
      : chain === Chain.Zksync
        ? normalized === ONE_INCH_V6_ZKSYNC_ROUTER
        : normalized === ONE_INCH_V5_ROUTER || normalized === ONE_INCH_V6_STANDARD_ROUTER

  if (!isKnown) {
    throw new Error(
      `${provider} swap quote returned an unrecognized router address (${address}) on ${chain} — refusing to build a signable transaction against it.`
    )
  }
}

/**
 * Log-only (never throws) — for LiFi/SwapKit, whose legitimate routes span many different
 * contracts. Structured so the data is queryable (provider + address) and a future allowlist
 * is easy to build if a stable pattern emerges from real usage.
 */
export function logUnenforcedAggregatorDestination(provider: string, address: string): void {
  console.info('[swap-router-telemetry] general-swap destination (not enforced, logged for future analysis):', {
    provider,
    address,
  })
}
