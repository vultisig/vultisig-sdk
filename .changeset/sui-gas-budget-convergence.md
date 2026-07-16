---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Fail Sui transaction construction when gas-budget re-pricing cannot cover the
final selected coin set instead of returning a known under-priced baseline.
