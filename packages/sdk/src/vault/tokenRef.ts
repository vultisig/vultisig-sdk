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

/**
 * Resolve a token ref to its ticker, decimals and contract address.
 *
 * @param chain Chain the ref is scoped to
 * @param ref Symbol, well-known ticker, contract address or vault token id.
 *   Omitted (or the chain's native ticker) resolves to the native asset.
 * @param userTokens The vault's configured tokens for `chain`
 * @throws VaultError(InvalidConfig) when the ref matches nothing
 */
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
  // Mirrors MAX_TICKER_LENGTH in tools/parse/tickerSchema.ts.
  return ref.length > 20
}

export function resolveTokenRef(chain: Chain, ref: string | undefined, userTokens: Token[]): ResolvedTokenInfo {
  const native = chainFeeCoin[chain]
  if (!ref || ref.toUpperCase() === native.ticker.toUpperCase()) {
    return { ticker: native.ticker, decimals: native.decimals }
  }

  const upper = ref.toUpperCase()
  const lower = ref.toLowerCase()
  const addressShaped = isAddressShapedRef(ref)

  // 1. The user's configured tokens — by contract address or stored id (the CLI's
  //    `--add` writes id as `<Chain>-<address>`, token discovery writes the bare
  //    address, so both are checked), then by symbol.
  //
  //    sdk#1634: an ADDRESS-SHAPED ref is never symbol-matched. Matching it by
  //    symbol is what let a poisoned token capture a correctly-typed address, and
  //    falling back to a symbol match when the address is not held would leave
  //    exactly that hole open for a victim who does not already hold the real
  //    token. An address the vault does not hold must fall through to the
  //    registry or fail — never to an attacker-named symbol.
  const byAddress = userTokens.find(
    t => t.contractAddress?.toLowerCase() === lower || t.id?.toLowerCase() === lower
  )
  const token = byAddress ?? (addressShaped ? undefined : userTokens.find(t => t.symbol?.toUpperCase() === upper))
  if (token) {
    return {
      ticker: token.symbol ?? token.contractAddress ?? token.id,
      decimals: token.decimals,
      contractAddress: token.contractAddress || token.id,
    }
  }

  // 2. Well-known token registry (no network call) — id first for an address-shaped
  //    ref, ticker otherwise. The registry is curated rather than attacker-populated,
  //    so its tickers are not the sdk#1634 hazard; the ordering is kept consistent
  //    with step 1 so an address-shaped ref means the same thing at both layers.
  const known = knownTokens[chain] ?? []
  const byId = known.find(t => t.id?.toLowerCase() === lower)
  const match = addressShaped ? byId : (known.find(t => t.ticker.toUpperCase() === upper) ?? byId)
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
