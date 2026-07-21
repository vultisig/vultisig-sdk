import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

import { Chain } from '../../Chain'
import { COW_VAULT_RELAYER_ADDRESS, cowSwapSupportedChains } from './cowswap/config'

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
 * CowSwap is ALSO enforced (sdk#1457): unlike 1inch/Kyber it doesn't route to a swap router at
 * all - orders settle off-chain via solvers, and the on-chain leg (both the swap-leg address AND
 * the ERC-20 approval spender) is always the same fixed GPv2VaultRelayer contract across every
 * supported chain (see build.ts / getSwapDestinationAddress.ts). That determinism makes it just
 * as allow-listable as 1inch/Kyber's routers.
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
 * allowlist has real usage data to build from if a pattern emerges. sdk#1457: because they are
 * the only genuinely unenforceable-by-address providers, they are the one residual gap
 * assertKnownAggregatorRouterOnSigningPath's provider-string closed-list still can't structurally
 * close - see that function's doc comment.
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

export type EnforcedRouterProvider = '1inch' | 'kyber' | 'cowswap'

const ENFORCED_ROUTER_PROVIDERS: ReadonlySet<string> = new Set<EnforcedRouterProvider>(['1inch', 'kyber', 'cowswap'])

// sdk#1457: the small, closed set of provider values the codebase legitimately produces for a
// route that is genuinely NOT address-allow-listable. `li.fi`/`swapkit` route through many
// different bridge/DEX contracts by design (see the file doc comment). `''` is NOT an attacker
// label - it is the documented fallback mapSwapPayload.ts (and getKeysignSwapPayload's own
// callers) use for pre-provider-field mobile captures, proven by real golden fixtures
// (mobileFixtures.golden.test.ts's arb.json/lifiswap.json) that still carry an unset provider.
// This is a CLOSED list, not "everything not enforced": a `provider` string outside BOTH this
// set and ENFORCED_ROUTER_PROVIDERS is unrecognized and rejected below, instead of silently logged.
const RECOGNIZED_UNENFORCED_PROVIDERS: ReadonlySet<string> = new Set(['li.fi', 'swapkit', ''])

/**
 * Signing-path re-assert (sdk#1358): the same allow-list check as {@link assertKnownAggregatorRouter},
 * but keyed off an arbitrary provider STRING (the value carried in KeysignSwapPayload.general.provider,
 * which is a plain `string`). Enforced providers (1inch/kyber/cowswap) fail closed; the small closed set
 * of genuinely unenforceable providers (li.fi/swapkit, plus the legacy `''` unattributed provider - see
 * RECOGNIZED_UNENFORCED_PROVIDERS) fall through to the same log-only path they take at quote construction;
 * anything else is rejected outright (sdk#1457, see below).
 *
 * WHY THIS EXISTS SEPARATELY FROM quote construction: a compromised initiator (or server composing the
 * intent) can hand a co-signer a KeysignPayload whose swapPayload.quote.tx.to was NEVER run through the
 * quote-time check - every co-signer independently rebuilds the signing input from that payload, so the
 * guard has to run HERE too, on the signing-input path, or a co-signer (e.g. VultiServer in a 2-of-2)
 * signs a destination it never validated. Mirrors the Ripple resolver's in-resolver fail-closed binding.
 *
 * THREAT MODEL / TRUST OF `provider` (CodeRabbit security review; sdk#1457): `provider` here is the free
 * `provider` STRING on the OneInchSwapPayload proto (the `oneinchSwapPayload` oneof case carries
 * 1inch/li.fi/cowswap/kyber with only this string to tell them apart; swapkit's dedicated transfer route
 * is the one general provider that has its own oneof case - see getKeysignSwapPayload.ts). It is
 * therefore part of the attacker-influenceable payload, NOT a trusted oneof discriminant, and a payload
 * whose `provider` disagrees with its actual executing shape (an attacker relabeling to dodge
 * enforcement) is a real, closable gap - not just a theoretical one.
 *
 * sdk#1457 FIX: two structural improvements that need no proto change. (1) CowSwap is now enforced -
 * unlike li.fi/swapkit it settles through ONE fixed, deterministic contract (the GPv2VaultRelayer, see
 * assertKnownAggregatorRouter), so its destination is exactly as allow-listable as 1inch/Kyber's; a
 * payload can no longer relabel itself 'cowswap' to dodge a router check the way it previously could. (2)
 * the log-only fallback is now a CLOSED list of the provider values the codebase legitimately produces
 * (li.fi/swapkit, plus the legacy `''` unattributed provider) - a `provider` string outside every known
 * value (enforced or unenforced) is unrecognized and REJECTED, not silently passed through. Together
 * these shrink "relabel to escape enforcement" from "any string at all" down to exactly li.fi, swapkit,
 * and the legacy `''`, which remain unenforceable by address because they legitimately route through
 * many different contracts by design (see the file doc comment) - closing that residual gap needs the
 * provider identity to be a trusted wire discriminant instead of a free string, i.e. a proto oneof case
 * per provider (tracked in sdk#1457, not attempted here: a schema change on the shared commondata proto
 * is a cross-repo, cross-consumer change every native client (iOS/Android/Windows) also builds against).
 *
 * This guard remains MONOTONIC beyond that residual gap: it only ever THROWS (rejects) or no-ops - it
 * never makes anything signable that wasn't already.
 */
export function assertKnownAggregatorRouterOnSigningPath(provider: string, address: string, chain: Chain): void {
  if (ENFORCED_ROUTER_PROVIDERS.has(provider)) {
    // assertKnownAggregatorRouter fails closed on an unrecognized address, INCLUDING an empty/missing
    // one - an enforced-provider swap with no destination is itself a malformed intent we won't sign.
    assertKnownAggregatorRouter(provider as EnforcedRouterProvider, address, chain)
    return
  }
  if (!RECOGNIZED_UNENFORCED_PROVIDERS.has(provider)) {
    throw new Error(
      `Unrecognized swap provider "${provider}" on the co-signer signing path - refusing to sign a swap ` +
        'whose provider label does not match any known aggregator (enforced or unenforced).'
    )
  }
  // Unenforced (li.fi/swapkit): log-only, and log the ACTUAL provider so the usage dataset the future
  // allow-list is built from isn't poisoned by a coerced label. Skip a genuinely empty address.
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
 * Enforced providers (1inch/kyber/cowswap) MUST have `spender === routerDestination`; unenforced
 * providers (li.fi/swapkit) are NOT bound. CowSwap's spender IS its `tx.to` (both are the fixed
 * GPv2VaultRelayer - see getSwapDestinationAddress.ts), so it binds the same way 1inch/kyber do. Like
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
      : provider === 'cowswap'
        ? // CHAIN-SCOPED, same reason the 1inch arm is: the relayer is a deterministic address, so it
          // resolves on EVERY EVM chain, but CoW has only deployed the GPv2 stack on
          // cowSwapSupportedChains (findSwapQuote gates quotes to exactly those). Accepting it
          // chain-agnostically would let a tampered payload relabelled 'cowswap' on e.g. CronosChain /
          // Zksync / Blast — where eth_getCode at this address is literally `0x`, verified 2026-07-21 —
          // pass BOTH this guard and assertEnforcedSwapApprovalSpenderBound, so the co-signer would
          // sign an ERC-20 approve to a codeless address anyone can later claim via the deterministic
          // deployment proxy. Fail closed off the supported set.
          isOneOf(chain, cowSwapSupportedChains) && normalized === COW_VAULT_RELAYER_ADDRESS.toLowerCase()
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
