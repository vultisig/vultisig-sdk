---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Reject malformed or wrong-chain limit-swap destinations while decoding a memo, so co-signers fall back to generic payload review instead of seeing an invalid destination as an enriched order.
