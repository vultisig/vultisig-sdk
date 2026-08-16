import type { Chain } from '@vultisig/core-chain/Chain'

import { parseChain } from './chainSchema'
import { parseTicker } from './tickerSchema'

/**
 * Result of `parseAssetRef`.
 * A discriminated union — check `success` before accessing the payload.
 */
export type ParseAssetRefResult =
  | { success: true; chain: Chain; ticker?: string }
  | { success: false; error: string; input: string | null | undefined }

/** The separator in the SDK's `chain[:token]` text contract. */
const ASSET_REF_SEPARATOR = ':'

/**
 * Result of `splitAssetRef` — the GRAMMAR half of the contract, with no chain
 * resolution performed.
 */
export type SplitAssetRefResult =
  | { success: true; chainRef: string; ticker?: string }
  | { success: false; error: string; input: string | null | undefined }

/**
 * Split a `chain[:token]` ref into its two halves, validating the grammar and the
 * ticker format but NOT resolving the chain.
 *
 * This exists separately from `parseAssetRef` because not every consumer resolves
 * chains against the SDK's global registry. `clients/mcp`, for instance, must only
 * accept chains the caller's vault actually has, and resolves through its own
 * vault-scoped `resolveChain`. Such a consumer still wants the canonical grammar —
 * the multi-separator and empty-token rejections — without having the chain half
 * decided for it. Handing it `parseAssetRef` would silently widen (or narrow) which
 * chains its tools accept.
 *
 * @param input - A `chain` or `chain:token` string
 * @returns A discriminated union; never throws
 */
export function splitAssetRef(input: string | null | undefined): SplitAssetRefResult {
  if (input == null) {
    return { success: false, error: 'asset ref is required (got null or undefined).', input }
  }

  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { success: false, error: 'asset ref is required (got an empty string).', input }
  }

  const parts = trimmed.split(ASSET_REF_SEPARATOR)
  if (parts.length > 2) {
    return {
      success: false,
      error:
        `Malformed asset ref '${input}': expected 'chain' or 'chain:token', ` +
        `but found ${parts.length - 1} '${ASSET_REF_SEPARATOR}' separators (at most one is allowed).`,
      input,
    }
  }

  const [rawChain, rawTicker] = parts
  const chainRef = (rawChain ?? '').trim()
  if (chainRef.length === 0) {
    return { success: false, error: `Malformed asset ref '${input}': the chain half is empty.`, input }
  }

  // Bare `chain` — no token half was supplied at all.
  if (parts.length === 1) return { success: true, chainRef }

  // A separator was supplied, so the token half must actually be a ticker.
  // `'eth:'` is a caller mistake, not a bare-chain ref: silently downgrading it
  // would hide the very typo this parser exists to surface.
  const tickerResult = parseTicker(rawTicker)
  if (!tickerResult.success) {
    return { success: false, error: `Malformed asset ref '${input}': ${tickerResult.error}`, input }
  }

  return { success: true, chainRef, ticker: tickerResult.ticker }
}

/**
 * Safe-parse the SDK's `chain[:token]` text contract into a canonical chain plus
 * an optional ticker.
 *
 * ```ts
 * parseAssetRef('eth')            // { success: true, chain: 'Ethereum' }
 * parseAssetRef('eth:usdc')       // { success: true, chain: 'Ethereum', ticker: 'usdc' }
 * parseAssetRef('eth:usdc:extra') // { success: false, error: '…exactly one ":"…' }
 * ```
 *
 * sdk#1819: consumers were hand-splitting this contract locally — `clients/mcp`'s
 * `parseChainToken` did `input.split(':')` and read `parts[1]`. That shape is not
 * merely duplicated, it is wrong in two ways that fail silently:
 *
 * - `'eth:usdc:extra'` yields `symbol: 'usdc'` and **discards** `'extra'`, so a
 *   malformed ref is accepted as a valid one for a different asset.
 * - `'eth:'` yields `symbol: ''`, an empty ticker that is then carried downstream
 *   as if the caller had named a token.
 *
 * Both are FAIL-CLOSED here: a ref that is not exactly `chain` or `chain:token`
 * is rejected at the boundary rather than silently reinterpreted.
 *
 * ## What this does NOT do (TASK-021 boundary)
 *
 * The ticker half is FORMAT-ONLY, delegating to `parseTicker`. It is not resolved
 * to a contract address or token-metadata entry — that stays in the resolver layer
 * so the symbol→token collision concern lives in exactly one place. The chain half
 * delegates to `parseChain`, so every alias form `normalizeChain` accepts keeps
 * working unchanged.
 *
 * @param input - A `chain` or `chain:token` string
 * @returns A discriminated union; never throws
 */
export function parseAssetRef(input: string | null | undefined): ParseAssetRefResult {
  const split = splitAssetRef(input)
  if (!split.success) return { success: false, error: split.error, input: split.input }

  const chainResult = parseChain(split.chainRef)
  if (!chainResult.success) return { success: false, error: chainResult.error, input }

  return split.ticker === undefined
    ? { success: true, chain: chainResult.chain }
    : { success: true, chain: chainResult.chain, ticker: split.ticker }
}
