import type { CowSwapOrderKind, CowSwapQuoteObject } from '../types'

// AGG-01 (audit r2): the CowSwap order is EIP-712-signed AND POSTed with sellToken/buyToken/kind/
// partiallyFillable copied straight from the /quote RESPONSE. A compromised, buggy, or MITM'd apiBase could
// substitute a token (funds swap into an attacker-chosen asset) or flip kind sell<->buy (wrong amount
// semantics). Assert the response echoes what we REQUESTED on those fund-critical fields before anything is
// signed; fail closed (throw) on any mismatch. `receiver` is excluded — the order already uses the caller's
// own receiver, not the response's, so a substituted receiver can't reach the signed order. Kept in a
// config-free module (types-only import) so it's unit-testable without the chain graph.
export function assertCowSwapQuoteMatchesRequest(
  quote: Pick<CowSwapQuoteObject, 'sellToken' | 'buyToken' | 'kind' | 'partiallyFillable'>,
  req: { sellToken: string; buyToken: string; kind: CowSwapOrderKind; partiallyFillable: boolean }
): void {
  const mismatches: string[] = []
  if (quote.sellToken.toLowerCase() !== req.sellToken.toLowerCase())
    mismatches.push(`sellToken ${quote.sellToken} != requested ${req.sellToken}`)
  if (quote.buyToken.toLowerCase() !== req.buyToken.toLowerCase())
    mismatches.push(`buyToken ${quote.buyToken} != requested ${req.buyToken}`)
  if (quote.kind !== req.kind) mismatches.push(`kind ${quote.kind} != requested ${req.kind}`)
  if (quote.partiallyFillable !== req.partiallyFillable)
    mismatches.push(`partiallyFillable ${quote.partiallyFillable} != requested ${req.partiallyFillable}`)
  if (mismatches.length > 0)
    throw new Error(
      `CowSwap quote response does not match the request on fund-critical fields (compromised/buggy apiBase?): ${mismatches.join('; ')}`
    )
}
