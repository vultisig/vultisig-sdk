---
'@vultisig/core-chain': patch
---

Retry Cardano current-slot lookup before broadcast and submit when the tip guard is temporarily unavailable, while still blocking genuinely stale signed transactions.
