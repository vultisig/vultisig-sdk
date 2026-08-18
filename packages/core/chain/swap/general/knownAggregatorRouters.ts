import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

import { Chain, EvmChain } from '../../Chain'
import { scanAddressWithBlockaid } from '../../security/blockaid/address'
import { blockaidEvmChain } from '../../security/blockaid/evmChains'
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
 * LI.FI is enforced too (sdk#1458). Although its Diamond dispatches to many bridge/DEX contracts,
 * the user-facing transaction enters through one officially published, chain-scoped Diamond.
 * Most supported chains share the CREATE2 address below; HyperEVM, Robinhood, and zkSync do not.
 * LI.FI's approval spender can vary by route, so the Diamond remains the deterministic fast path
 * while any distinct spender requires an independent benign Blockaid verdict.
 * SwapKit remains dynamic because its target can be a provider router or a per-swap deposit
 * address. Its quote and co-signer paths therefore require an independent benign Blockaid
 * reputation verdict via {@link assertSwapKitAddressReputation}; the response-local
 * `targetAddress` equality check remains defense in depth only.
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

// V6 on Robinhood (4663) ONLY — the second chain-specific 1inch deployment after zkSync.
// Live-confirmed 2026-07-27: /approve/spender AND a real v6.0 /swap both return this
// address (NOT the standard one), and eth_getCode on 4663 shows 24,542 bytes deployed.
const ONE_INCH_V6_ROBINHOOD_ROUTER = '0x5a705de8982235a7fa45bb83dcacf03a211389c7'

// KyberSwap MetaAggregationRouterV2 — same address confirmed live 2026-07-08 on every
// kyberSwapEnabledChains chain through aggregator-api.kyberswap.com's /routes
// (Ethereum, BSC, Arbitrum, Optimism, Avalanche, Base, Polygon).
const KYBER_STANDARD_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'

// Official LI.FI Diamond deployment registry, read from
// github.com/lifinance/contracts/tree/main/deployments on 2026-08-08. Keep this
// deliberately chain-scoped: the exceptions are real deployments, not aliases.
const LIFI_DIAMOND_BY_CHAIN: Record<EvmChain, string> = {
  [Chain.Arbitrum]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Avalanche]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Base]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Blast]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.BSC]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.CronosChain]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Ethereum]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Hyperliquid]: '0x0a0758d937d1059c356d4714e57f5df0239bce1a',
  [Chain.Mantle]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Optimism]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Polygon]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Robinhood]: '0xb477751b76cf82d00a686a1232f5fcd772414af3',
  [Chain.Sei]: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  [Chain.Zksync]: '0x341e94069f53234fe6dabef707ad424830525715',
}

export type EnforcedRouterProvider = '1inch' | 'kyber' | 'cowswap' | 'li.fi'

const ENFORCED_ROUTER_PROVIDERS: ReadonlySet<string> = new Set<EnforcedRouterProvider>([
  '1inch',
  'kyber',
  'cowswap',
  'li.fi',
])

// These providers use the same fixed address for the user-facing router and approval spender.
// LI.FI is intentionally absent: its official API contract says approval spenders may vary by
// route or bridge, so distinct spenders use assertLifiApprovalAddress instead of hard equality.
const APPROVAL_BOUND_ROUTER_PROVIDERS: ReadonlySet<string> = new Set(['1inch', 'kyber', 'cowswap'])

// sdk#1457/#1458: the small, closed set of recognized providers outside the fixed-router
// allowlists. SwapKit targets are dynamic and use Blockaid; `''` is NOT an attacker label - it is
// the documented fallback mapSwapPayload.ts (and getKeysignSwapPayload's own
// callers) use for pre-provider-field mobile captures, proven by real golden fixtures
// (mobileFixtures.golden.test.ts's arb.json/lifiswap.json) that still carry an unset provider.
// This is a CLOSED list, not "everything not enforced": a `provider` string outside BOTH this
// set and ENFORCED_ROUTER_PROVIDERS is unrecognized and rejected below, instead of silently logged.
const RECOGNIZED_DYNAMIC_OR_LEGACY_PROVIDERS: ReadonlySet<string> = new Set(['swapkit', ''])

/**
 * Signing-path re-assert (sdk#1358): the same allow-list check as {@link assertKnownAggregatorRouter},
 * but keyed off an arbitrary provider STRING (the value carried in KeysignSwapPayload.general.provider,
 * which is a plain `string`). Fixed-router providers fail closed against their allowlists, SwapKit
 * fails closed against an independent Blockaid reputation verdict, and only the legacy `''`
 * unattributed provider remains log-only. Anything else is rejected outright (sdk#1457, see below).
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
 * unlike swapkit it settles through ONE fixed, deterministic contract (the GPv2VaultRelayer, see
 * assertKnownAggregatorRouter), so its destination is exactly as allow-listable as 1inch/Kyber's; a
 * payload can no longer relabel itself 'cowswap' to dodge a router check the way it previously could. (2)
 * the log-only fallback is now a CLOSED list of the provider values the codebase legitimately produces
 * (at that time li.fi/swapkit, plus the legacy `''` unattributed provider) - a `provider` string outside every known
 * value (enforced or unenforced) is unrecognized and REJECTED, not silently passed through. Together
 * these originally shrank "relabel to escape enforcement" from "any string at all" to that closed set.
 * sdk#1458 subsequently removes li.fi from the residual gap using its official Diamond deployments
 * and applies an independent Blockaid reputation check to SwapKit destinations on both quote and
 * co-signer paths. The legacy unattributed value remains the only log-only compatibility case.
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
  if (provider === 'swapkit') {
    throw new Error(
      'SwapKit destinations require the asynchronous independent reputation guard — refusing a synchronous log-only check.'
    )
  }
  if (!RECOGNIZED_DYNAMIC_OR_LEGACY_PROVIDERS.has(provider)) {
    throw new Error(
      `Unrecognized swap provider "${provider}" on the co-signer signing path - refusing to sign a swap ` +
        'whose provider label does not match any known aggregator (enforced or unenforced).'
    )
  }
  // Legacy unattributed payloads remain log-only for compatibility with historical mobile captures.
  // Log the actual provider so the usage dataset isn't poisoned by a coerced label. Skip a genuinely empty address.
  if (address) {
    logUnenforcedAggregatorDestination(provider, address)
  }
}

/**
 * Independent reputation boundary shared by dynamic aggregator addresses. Only an explicit
 * Benign Blockaid verdict is accepted; unsupported chains, scan failures, Warning, and Malicious
 * verdicts all fail closed.
 */
async function assertAggregatorAddressReputation(
  provider: 'LI.FI' | 'SwapKit',
  address: string,
  chain: Chain,
  role = 'destination'
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${provider} ${role} (${address}) is not a valid EVM address on ${chain}.`)
  }

  const blockaidChain = (blockaidEvmChain as Partial<Record<Chain, string>>)[chain]
  if (!blockaidChain) {
    throw new Error(`${provider} ${role} reputation cannot be verified on unsupported Blockaid chain ${chain}.`)
  }

  let result: Awaited<ReturnType<typeof scanAddressWithBlockaid>>
  try {
    result = await scanAddressWithBlockaid(address, blockaidChain)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${provider} ${role} reputation check failed on ${chain}: ${reason}`)
  }

  if (result.resultType !== 'Benign') {
    const features = result.features.length ? ` (${result.features.join(', ')})` : ''
    throw new Error(
      `${provider} ${role} (${address}) received a ${result.resultType} Blockaid verdict on ${chain}${features} — refusing to sign or return the transaction.`
    )
  }
}

/**
 * Independent trust boundary for dynamic SwapKit EVM addresses. SwapKit's `tx.to`,
 * `targetAddress`, and optional approval transaction all come from the same `/v3/swap`
 * response, so equality between them cannot establish destination safety when that response
 * is compromised.
 */
export function assertSwapKitAddressReputation(address: string, chain: Chain, role = 'destination'): Promise<void> {
  return assertAggregatorAddressReputation('SwapKit', address, chain, role)
}

/**
 * LI.FI documents `estimate.approvalAddress` as route-dependent and explicitly warns consumers
 * not to hardcode it. The official Diamond is safe without a network dependency; a distinct
 * spender is accepted only after an independent benign Blockaid verdict. This preserves valid
 * inner-executor routes without trusting the quote response to authorize its own spender.
 */
export function assertLifiApprovalAddress(address: string, chain: Chain): Promise<void> {
  if (address.toLowerCase() === LIFI_DIAMOND_BY_CHAIN[chain as EvmChain]) {
    return Promise.resolve()
  }

  return assertAggregatorAddressReputation('LI.FI', address, chain, 'approval spender')
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
 * On the initiator the fixed-spender providers coincide by construction. LI.FI and SwapKit can
 * instead set an explicit `approvalAddress`, which is why their spender checks are separate.
 * Approval-bound providers (1inch/kyber/cowswap) MUST have `spender === routerDestination`.
 * LI.FI approval spenders can vary by route and are instead checked by
 * {@link assertLifiApprovalAddress}; SwapKit spenders use its corresponding reputation guard.
 * CowSwap's spender IS its `tx.to` (both are the fixed GPv2VaultRelayer - see
 * getSwapDestinationAddress.ts), so it binds the same way 1inch/kyber do. Like its sibling this is
 * a MONOTONIC gate: it only throws or no-ops, never changes the signed bytes.
 */
export function assertEnforcedSwapApprovalSpenderBound(
  provider: string,
  spender: string,
  routerDestination: string,
  chain: Chain
): void {
  if (!APPROVAL_BOUND_ROUTER_PROVIDERS.has(provider)) {
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
      : provider === 'li.fi'
        ? normalized === LIFI_DIAMOND_BY_CHAIN[chain as EvmChain]
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
            : chain === Chain.Robinhood
              ? normalized === ONE_INCH_V6_ROBINHOOD_ROUTER
              : normalized === ONE_INCH_V5_ROUTER || normalized === ONE_INCH_V6_STANDARD_ROUTER

  if (!isKnown) {
    throw new Error(
      `${provider} swap quote returned an unrecognized router address (${address}) on ${chain} — refusing to build a signable transaction against it.`
    )
  }
}

/**
 * SwapKit v3 returns `targetAddress` independently from the ready-to-sign EVM
 * transaction and defines it as the address the transaction must call or transfer to.
 * Bind those fields before constructing a GeneralSwapQuote so a substituted `tx.to`
 * cannot silently become the signed destination (or the approval fallback).
 */
export function assertSwapKitDestinationMatchesTarget(
  address: string,
  targetAddress: string | undefined,
  chain: Chain
): void {
  if (!targetAddress || !/^0x[0-9a-fA-F]{40}$/.test(targetAddress)) {
    throw new Error(
      `SwapKit swap response did not include a valid targetAddress on ${chain} — refusing to trust tx.to.`
    )
  }

  if (address.toLowerCase() !== targetAddress.toLowerCase()) {
    throw new Error(
      `SwapKit swap transaction destination (${address}) does not match the screened targetAddress (${targetAddress}) on ${chain} — refusing to build a signable transaction.`
    )
  }
}

/**
 * Log-only (never throws) — retained only for legacy unattributed signing payloads.
 */
export function logUnenforcedAggregatorDestination(provider: string, address: string): void {
  console.info('[swap-router-telemetry] general-swap destination (not enforced, logged for future analysis):', {
    provider,
    address,
  })
}
