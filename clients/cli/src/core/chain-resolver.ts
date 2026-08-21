import { Chain } from '@vultisig/sdk'

// Imported from the leaf module rather than the '../interactive' barrel: the barrel
// pulls in the shell session, which imports '../core' back, and that cycle would make
// core transitively load the whole shell + command tree.
import { findChainByName } from '../interactive/completer'
import { InvalidChainError } from './errors'

type OptionalChainInput = string | undefined | null

/**
 * Compact string-distance for "did you mean" hints. Not a full Levenshtein —
 * this only needs to spot brand-name close-matches like Cronos↔CronosChain,
 * Arb↔Arbitrum, so we combine (a) case-insensitive substring containment
 * (either direction) with (b) prefix match, weighting shorter deltas higher.
 * Returns up to `limit` suggestions ordered by relevance. bead vultisig-7eymb.
 */
export function suggestChainNames(input: string, limit = 3): Chain[] {
  const raw = input.trim()
  if (!raw) return []
  const lower = raw.toLowerCase()
  const all = Object.values(Chain) as string[]

  const scored: Array<{ name: string; score: number }> = []
  for (const c of all) {
    const cLower = c.toLowerCase()
    if (cLower === lower) continue // exact match wouldn't reach this path anyway
    let score = 0
    // Prefix match: 'cronos' → 'cronoschain' scores highest
    if (cLower.startsWith(lower)) score = 100 - (cLower.length - lower.length)
    // Reverse prefix: 'arbitrum' input, 'arb' known would score too — but rare
    else if (lower.startsWith(cLower)) score = 90 - (lower.length - cLower.length)
    // Substring contains
    else if (cLower.includes(lower)) score = 60 - Math.abs(cLower.length - lower.length)
    else if (lower.includes(cLower)) score = 50 - Math.abs(lower.length - cLower.length)
    if (score > 0) scored.push({ name: c, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.name as Chain)
}

/**
 * Resolve a user-supplied chain name, or throw INVALID_CHAIN.
 *
 * Call sites historically wrote `findChainByName(input) || (input as Chain)`, which
 * launders an unknown name into a `Chain` and defers the failure to whatever the
 * command does next — `tokens bogus-chain` reported `success: true` with an empty
 * list, and `swap-quote bogus-chain ...` surfaced a raw TypeError. Resolving up
 * front turns both into the same typed, non-retryable INVALID_CHAIN.
 *
 * `label` names the argument in the message, so a two-chain command can say which
 * side was wrong.
 *
 * On miss, includes a "Did you mean" hint (bead vultisig-7eymb) so common brand
 * names like `Cronos` (SDK enum is `CronosChain`) or `Arb` (`Arbitrum`) don't
 * force the user to `vultisig chains` and grep.
 */
export function resolveChainOrThrow(input: string, label = 'chain'): Chain {
  const chain = findChainByName(input)
  if (!chain) {
    const suggestions = suggestChainNames(input)
    const hint =
      suggestions.length > 0
        ? `Did you mean: ${suggestions.join(', ')}? Or run "vultisig chains" to see the supported chains.`
        : 'Run "vultisig chains" to see the supported chains, or check the spelling.'
    throw new InvalidChainError(
      `Unsupported ${label}: "${input}"`,
      hint,
      undefined,
      // context values must be strings — flatten suggestions into a comma-joined
      // field so JSON callers can parse it back deterministically.
      { chain: input, ...(suggestions.length > 0 ? { suggestions: suggestions.join(',') } : {}) }
    )
  }
  return chain
}

export function resolveOptionalChainOrThrow(input: OptionalChainInput, label = 'chain'): Chain | undefined {
  if (input === undefined || input === null) return undefined
  return resolveChainOrThrow(input, label)
}
