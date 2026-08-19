---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Reject memo input in the pure TRC-20 calldata prep helper so callers do not mistake descriptor metadata for Tron transaction-level memo bytes.
