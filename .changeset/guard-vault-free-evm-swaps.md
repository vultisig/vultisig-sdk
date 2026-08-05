---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Bind raw swap quotes to their exact coin identities, requested source amount, absolute expiry, and returned transaction, then reject missing, stale, mismatched, or mutated quotes in the vault-free swap preparation path before any payload construction.
