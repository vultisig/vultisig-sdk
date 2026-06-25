---
'@vultisig/sdk': minor
---

Add `sdk.swap.acrossQuote` — a read-only Across bridge quote primitive (ported from the mcp-ts `get_across_quote` tool). Fetches a live Across `suggested-fees` quote, pins + verifies the origin/destination SpokePool deployments (fail-closed on upstream schema drift), checksums + validates inputs, and rejects burn-address recipients via the shared `assertSafeDestination` guard. Quote-only: never builds calldata, signs, or broadcasts. Exported as `acrossQuote`, `acrossSupportedChains`, and the `AcrossChain` / `AcrossQuote` / `AcrossQuoteParams` types.
