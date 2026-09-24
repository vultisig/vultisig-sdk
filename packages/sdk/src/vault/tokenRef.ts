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
 * Exact token identities take precedence over symbols, including short asset
 * ids. Address/id-shaped refs never fall back to attacker-controlled symbols.
 * Ordinary tickers still prefer the user's tokens over the known registry.
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

/** An unmatched asset identifier must not be interpreted as a token symbol. */
function isIdentityShapedRef(chain: Chain, ref: string): boolean {
  const kind = getChainKind(chain)
  return (
    /^\d+$/u.test(ref) ||
    ref.toLowerCase().startsWith(`${chain}-`.toLowerCase()) ||
    /^0x[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(ref) ||
    (kind === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(ref)) ||
    (kind === 'tron' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(ref)) ||
    (kind === 'cosmos' && /^(?:x\/|ibc\/|factory\/)/u.test(ref)) ||
    (chain === Chain.THORChain && ref.toLowerCase().startsWith('thor.')) ||
    (chain === Chain.THORChain &&
      /^(?:avax|base|bch|bsc|btc|doge|eth|gaia|ltc|xrp)-[a-z0-9]+(?:-[a-z0-9]+)*$/iu.test(ref)) ||
    (kind === 'cosmos' && /^[a-z0-9]{2,}1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/u.test(ref)) ||
    (kind === 'sui' && /^0x[0-9a-f]+::/iu.test(ref)) ||
    (kind === 'ripple' && /\.r[1-9A-HJ-NP-Za-km-z]{25,35}$/u.test(ref)) ||
    (kind === 'ton' && /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/u.test(ref)) ||
    (kind === 'ton' && /^(?:0|-1):[0-9a-f]{64}$/iu.test(ref)) ||
    (kind === 'cardano' && /^[0-9a-f]{56}\.[0-9a-f]*$/iu.test(ref))
  )
}

/** Match a caller's explicit stored/registry ID without treating a ticker case variant as an ID. */
export function tokenRefIdsMatch(chain: Chain, storedId: string | undefined, ref: string): boolean {
  if (storedId === undefined) return false
  if (stripLegacyTokenIdPrefix(chain, storedId) === stripLegacyTokenIdPrefix(chain, ref)) return true
  return (
    isIdentityShapedRef(chain, ref) &&
    (tokenIdsMatch(chain, storedId, ref) || caseInsensitiveTokenIdsMatch(chain, storedId, ref))
  )
}

class AmbiguousTokenRefError extends VaultError {}

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

  const known = knownTokens[chain] ?? []
  // Stored identities win at any length, including short numeric asset IDs.
  const userById = userTokens.find(
    t =>
      tokenRefIdsMatch(chain, t.contractAddress, ref) ||
      (tokenRefIdsMatch(chain, t.id, ref) &&
        (!isIdentityShapedRef(chain, ref) || tokenRefIdsMatch(chain, t.contractAddress || t.id, ref)))
  )
  if (userById) {
    return {
      ticker: userById.symbol ?? userById.contractAddress ?? userById.id,
      decimals: userById.decimals,
      contractAddress: stripLegacyTokenIdPrefix(chain, userById.contractAddress || userById.id),
    }
  }

  const knownById = known.find(t => tokenRefIdsMatch(chain, t.id, ref))
  if (knownById) return { ticker: knownById.ticker, decimals: knownById.decimals, contractAddress: knownById.id }

  if (isIdentityShapedRef(chain, ref)) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `Token "${ref}" not found on ${chain}. Pass a known token id or add it with vault.addToken().`
    )
  }

  const upper = ref.toUpperCase()
  const symbolMatches = userTokens.filter(t => t.symbol?.toUpperCase() === upper)
  const baseSymbolMatches = userTokens.filter(t => tokenSymbolBase(t.symbol)?.toUpperCase() === upper)
  const distinctSymbolAssets = new Map([...symbolMatches, ...baseSymbolMatches].map(t => [tokenAssetId(chain, t), t]))

  if (distinctSymbolAssets.size > 1) {
    const contractAddresses = [...distinctSymbolAssets.values()].map(t => tokenAssetId(chain, t)).join(', ')
    throw new AmbiguousTokenRefError(
      VaultErrorCode.InvalidConfig,
      `Token symbol "${ref}" is ambiguous on ${chain}; it matches multiple contract addresses (${contractAddresses}). Pass the intended contract address instead.`
    )
  }

  // Ordinary ticker lookup still prefers configured tokens over the registry.
  const token = symbolMatches[0]
  if (token) {
    return {
      ticker: token.symbol ?? token.contractAddress ?? token.id,
      decimals: token.decimals,
      contractAddress: stripLegacyTokenIdPrefix(chain, token.contractAddress || token.id),
    }
  }

  // Well-known token registry (no network call) — ticker only; ids were checked above.
  const match = known.find(t => t.ticker.toUpperCase() === upper)
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
