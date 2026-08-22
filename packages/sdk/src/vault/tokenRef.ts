/**
 * Token reference resolution — the single definition of "which token does this
 * string mean?" for the whole vault surface.
 *
 * A *token ref* is whatever a caller uses to name a non-native asset: its symbol
 * (`USDC`), the ticker of a well-known token, or its contract address / stored
 * vault token id (`0xA0b8…`). `vault.send({ symbol })`, `vault.swap` and
 * `vault.balance(chain, tokenId)` all route through here, so a single ref cannot
 * mean one asset to the send path and something else to the balance path.
 *
 * Lookup order is deliberate and additive: for a plain ticker ref, symbol is
 * tried BEFORE contract address, and the user's own tokens before the well-known
 * registry. Every ref that resolved before this module existed resolves to
 * exactly the same token — the only change is that refs which used to throw now
 * resolve.
 *
 * ADDRESS-SHAPED refs are the exception, and it is a fund-safety one (sdk#1634):
 * they never match a symbol at all. Vault token symbols are attacker-controlled
 * strings persisted from on-chain discovery, so a symbol-first order let a scam
 * token whose `symbol` field is set to the LITERAL TEXT of real USDC's contract
 * address capture a send in which the victim typed that genuine address
 * correctly — resolving amount, decimals and the keysign target to the scam
 * contract. Address-shaped refs threw entirely before this module existed, so
 * refusing to symbol-match them changes nothing that ever resolved.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { normalizeTokenId } from '@vultisig/core-chain/utils/isValidTokenId'

import type { Token } from '../types'
import { VaultError, VaultErrorCode } from './VaultError'

/** The subset of token data the transaction and balance layers need. */
export type ResolvedTokenInfo = {
  ticker: string
  decimals: number
  /** Contract address / chain-level asset id. Absent for the chain's native asset. */
  contractAddress?: string
}

/** Strip the chain prefix written by older CLI `tokens --add` versions. */
export function stripLegacyTokenIdPrefix(chain: Chain, id: string): string {
  const prefix = `${chain}-`
  return id.toLowerCase().startsWith(prefix.toLowerCase()) ? id.slice(prefix.length) : id
}

/** Normalize only the chain ids whose core contract defines a canonical form. */
export function normalizedTokenIdentity(chain: Chain, id: string): string {
  return normalizeTokenId({ chain, id: stripLegacyTokenIdPrefix(chain, id) })
}

/** Compare bare and legacy-prefixed storage ids without changing symbol lookup. */
export function tokenIdsMatch(chain: Chain, left: string | undefined, right: string): boolean {
  return left !== undefined && normalizedTokenIdentity(chain, left) === normalizedTokenIdentity(chain, right)
}

/** Preserve legacy EVM address matching while keeping other chain ids case-sensitive. */
function caseInsensitiveTokenIdsMatch(chain: Chain, left: string | undefined, right: string): boolean {
  return (
    left !== undefined &&
    getChainKind(chain) === 'evm' &&
    stripLegacyTokenIdPrefix(chain, left).toLowerCase() === stripLegacyTokenIdPrefix(chain, right).toLowerCase()
  )
}

/** Remove discovery-only disambiguators when checking whether a bare symbol is ambiguous. */
function tokenSymbolBase(symbol: string | undefined): string | undefined {
  return symbol?.replace(/@[a-z0-9]{8,}$/iu, '').replace(/_\d+$/u, '')
}

function tokenAssetId(chain: Chain, token: Token): string {
  return normalizedTokenIdentity(chain, token.contractAddress || token.id)
}

class AmbiguousTokenRefError extends VaultError {}

/**
 * Is this ref an asset ADDRESS/id rather than a ticker? (sdk#1634)
 *
 * Deliberately shape-based and chain-agnostic rather than a per-chain address
 * validator: the question here is only "could a human have meant this as a
 * ticker?", and getting a false NEGATIVE reopens the spoofing hole.
 *
 * - `0x` + 40 hex (EVM) and `0x` + 64 hex (Sui/Aptos-style) are matched exactly.
 * - Anything longer than a ticker can legitimately be is treated as an address.
 *   The SDK's own `tickerSchema` caps a ticker at 20 characters, so a longer ref
 *   is not a ticker by this SDK's own definition. That covers Solana SPL mints
 *   (32-44 base58), Tron (34), Cosmos bech32 contracts, and the CLI's stored
 *   `<Chain>-<address>` id form, without guessing at per-chain encodings.
 */
function isAddressShapedRef(ref: string): boolean {
  if (/^0x[0-9a-fA-F]{40}$/.test(ref) || /^0x[0-9a-fA-F]{64}$/.test(ref)) return true
  // Discovery-disambiguated symbols (`WIDGET@1deadbeef`, see tokenSymbolBase's
  // `@[a-z0-9]{8,}$` suffix) can exceed the ticker length cap below but are
  // never address-shaped — no supported chain's address format contains `@`.
  if (ref.includes('@')) return false
  // Mirrors MAX_TICKER_LENGTH in tools/parse/tickerSchema.ts.
  return ref.length > 20
}

/**
 * Resolve a token ref to its ticker, decimals and contract address.
 *
 * @param chain Chain the ref is scoped to
 * @param ref Symbol, well-known ticker, contract address or vault token id.
 *   Omitted (or the chain's native ticker) resolves to the native asset.
 * @param userTokens The vault's configured tokens for `chain`
 * @throws VaultError(InvalidConfig) when the ref matches nothing
 */
export function resolveTokenRef(chain: Chain, ref: string | undefined, userTokens: Token[]): ResolvedTokenInfo {
  const native = chainFeeCoin[chain]
  if (!ref || ref.toUpperCase() === native.ticker.toUpperCase()) {
    return { ticker: native.ticker, decimals: native.decimals }
  }

  const upper = ref.toUpperCase()
  const addressShaped = isAddressShapedRef(ref)

  // sdk#1634: an ADDRESS-SHAPED ref never considers a symbol match at all — not
  // for ambiguity detection, and not for resolution. Vault token symbols are
  // attacker-controlled strings persisted from on-chain discovery; matching a
  // ref that's shaped like an address by symbol is what let a poisoned token
  // capture a correctly-typed real contract address. `symbolMatches` /
  // `baseSymbolMatches` are left empty rather than skipping the block below, so
  // the existing ambiguity check naturally stays a no-op for address-shaped refs.
  const symbolMatches = addressShaped ? [] : userTokens.filter(t => t.symbol?.toUpperCase() === upper)
  const baseSymbolMatches = addressShaped
    ? []
    : userTokens.filter(t => tokenSymbolBase(t.symbol)?.toUpperCase() === upper)
  const distinctSymbolAssets = new Map([...symbolMatches, ...baseSymbolMatches].map(t => [tokenAssetId(chain, t), t]))

  if (distinctSymbolAssets.size > 1) {
    const contractAddresses = [...distinctSymbolAssets.values()].map(t => tokenAssetId(chain, t)).join(', ')
    throw new AmbiguousTokenRefError(
      VaultErrorCode.InvalidConfig,
      `Token symbol "${ref}" is ambiguous on ${chain}; it matches multiple contract addresses (${contractAddresses}). Pass the intended contract address instead.`
    )
  }

  // 1. The user's configured tokens — by symbol first (for a plain ticker ref
  //    only — never for an address-shaped one, see above), then by contract
  //    address or stored id. Legacy `<Chain>-<address>` ids and canonical bare
  //    ids are treated as the same storage identity. An address the vault does
  //    not hold must fall through to the registry or fail — never resolve via
  //    an attacker-named symbol.
  const userIdMatch =
    userTokens.find(t => tokenIdsMatch(chain, t.contractAddress, ref) || tokenIdsMatch(chain, t.id, ref)) ??
    userTokens.find(
      t => caseInsensitiveTokenIdsMatch(chain, t.contractAddress, ref) || caseInsensitiveTokenIdsMatch(chain, t.id, ref)
    )
  const token = addressShaped ? userIdMatch : (symbolMatches[0] ?? userIdMatch)
  if (token) {
    return {
      ticker: token.symbol ?? token.contractAddress ?? token.id,
      decimals: token.decimals,
      contractAddress: stripLegacyTokenIdPrefix(chain, token.contractAddress || token.id),
    }
  }

  // 2. Well-known token registry (no network call) — id first for an address-shaped
  //    ref, ticker otherwise. The registry is curated rather than attacker-populated,
  //    so its tickers are not the sdk#1634 hazard; the ordering is kept consistent
  //    with step 1 so an address-shaped ref means the same thing at both layers.
  const known = knownTokens[chain] ?? []
  const knownIdMatch =
    known.find(t => tokenIdsMatch(chain, t.id, ref)) ?? known.find(t => caseInsensitiveTokenIdsMatch(chain, t.id, ref))
  const match = addressShaped ? knownIdMatch : (known.find(t => t.ticker.toUpperCase() === upper) ?? knownIdMatch)
  if (match) return { ticker: match.ticker, decimals: match.decimals, contractAddress: match.id }

  throw new VaultError(
    VaultErrorCode.InvalidConfig,
    `Token "${ref}" not found on ${chain}. Pass a token symbol or contract address, or add it with vault.addToken().`
  )
}

/**
 * Map a token ref to the contract address / asset id that the balance and price
 * layers key on. Returns `undefined` for the native asset.
 *
 * A ref that matches nothing is returned unchanged rather than throwing: callers
 * have always been able to pass a raw contract address that is in no registry,
 * and that must keep working.
 */
export function resolveTokenRefId(chain: Chain, ref: string | undefined, userTokens: Token[]): string | undefined {
  if (!ref) return undefined
  try {
    return resolveTokenRef(chain, ref, userTokens).contractAddress
  } catch (error) {
    if (error instanceof AmbiguousTokenRefError) throw error
    return ref
  }
}
