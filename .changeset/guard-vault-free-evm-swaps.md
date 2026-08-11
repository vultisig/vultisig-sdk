---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

Bind raw swap quotes to their exact coin identities, requested source amount, absolute expiry, and returned transaction, then reject missing, stale, mismatched, or mutated quotes in the vault-free swap preparation path before any payload construction. General quotes remain preparation-valid for five minutes while SDK presentation continues to recommend refreshing after 60 seconds, and vault-free callers can catch `SwapQuoteExpiredError` to requote.

Consumers must pass the live bound quote returned by `findSwapQuote` or `getSwapQuote` into preparation instead of constructing or persisting an unbound raw quote. Structured cloning is supported; JSON round-tripping is not because it loses required runtime value types such as `bigint`.
