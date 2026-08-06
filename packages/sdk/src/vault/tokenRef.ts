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
 * Lookup order is deliberate and additive: symbol/ticker is tried BEFORE
 * contract address, and the user's own tokens before the well-known registry.
 * Every ref that resolved before this module existed resolves to exactly the
 * same token — the only change is that refs which used to throw now resolve.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'

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

/** Compare bare and legacy-prefixed storage ids without changing symbol lookup. */
export function tokenIdsMatch(chain: Chain, left: string | undefined, right: string): boolean {
  return (
    left !== undefined &&
    stripLegacyTokenIdPrefix(chain, left).toLowerCase() === stripLegacyTokenIdPrefix(chain, right).toLowerCase()
  )
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
  const lower = ref.toLowerCase()
  // 1. The user's configured tokens — by symbol first, then by contract address
  //    or stored id. Legacy `<Chain>-<address>` ids and canonical bare ids are
  //    treated as the same storage identity.
  const token =
    userTokens.find(t => t.symbol?.toUpperCase() === upper) ??
    userTokens.find(t => t.contractAddress?.toLowerCase() === lower || t.id?.toLowerCase() === lower) ??
    userTokens.find(t => tokenIdsMatch(chain, t.contractAddress, ref) || tokenIdsMatch(chain, t.id, ref))
  if (token) {
    return {
      ticker: token.symbol ?? token.contractAddress ?? token.id,
      decimals: token.decimals,
      contractAddress: stripLegacyTokenIdPrefix(chain, token.contractAddress || token.id),
    }
  }

  // 2. Well-known token registry (no network call) — ticker first, then id.
  const known = knownTokens[chain] ?? []
  const match =
    known.find(t => t.ticker.toUpperCase() === upper) ??
    known.find(t => t.id?.toLowerCase() === lower) ??
    known.find(t => tokenIdsMatch(chain, t.id, ref))
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
  } catch {
    return ref
  }
}
