---
'@vultisig/sdk': minor
---

Narrow `acrossQuote`'s `sourceChain` to the origin it actually accepts. The parameter was typed as any `AcrossChain` and the JSDoc example passed `'Base'`, but the runtime rejects every non-Ethereum origin, so the documented call compiled and then threw. `sourceChain` is now `AcrossOriginChain`, and `ACROSS_ORIGIN_CHAIN` is exported so callers can branch on the limit instead of discovering it by catching. The fail-closed runtime guard is unchanged for untyped callers.
