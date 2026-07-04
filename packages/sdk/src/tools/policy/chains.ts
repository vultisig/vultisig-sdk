/**
 * Canonical↔alias chain matching for the policy diff.
 *
 * Ported verbatim from the Go reference `internal/safety/policy.go`
 * (`chainAliasMap` + `chainsMatch`). This is the Slice-0 alias set; it
 * intentionally mirrors the Go table 1:1 so the cross-surface verdict cannot
 * drift. Both sides are expected pre-lowercased/trimmed by the caller.
 */

/** Slice-0 canonical↔alias chain map (mirrors the Go `chainAliasMap`). */
export const chainAliasMap: Readonly<Record<string, string>> = {
  eth: 'ethereum',
  bnb: 'bsc',
  bsc: 'bsc',
  avax: 'avalanche',
  cosmos: 'cosmoshub-4',
  terra: 'phoenix-1',
  terraclassic: 'columbus-5',
  lunc: 'columbus-5',
  osmosis: 'osmosis-1',
  noble: 'noble-1',
  dydx: 'dydx-mainnet-1',
  akash: 'akashnet-2',
}

/**
 * Returns true if two canonical chain strings represent the same chain,
 * resolving the canonical↔alias mappings in `chainAliasMap`. Inputs are
 * compared as-is (the caller lowercases/trims).
 */
export function chainsMatch(a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  const canonA = chainAliasMap[a] ?? a
  const canonB = chainAliasMap[b] ?? b
  return canonA === canonB
}
