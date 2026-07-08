---
'@vultisig/sdk': patch
---

fix(swap): validate the CowSwap quote response against the request before signing (AGG-01)

The CowSwap order is EIP-712-signed and POSTed with `sellToken`/`buyToken`/`kind`/`partiallyFillable` copied straight from the `/quote` API response. A compromised, buggy, or MITM'd `apiBase` could substitute a token (funds swap into an attacker-chosen asset) or flip `kind` sell↔buy. `assertCowSwapQuoteMatchesRequest` now asserts the response echoes the requested values on those fund-critical fields and throws on any mismatch before the order is built. `receiver` is unaffected — the order already uses the caller's own receiver, not the response's.
