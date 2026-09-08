---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Reject Tron gateway errors, empty contract balance results, and JSON-RPC errors instead of treating them as zero balances or decoding error messages. Preserve legitimate zero balances and propagate read failures to maximum-send callers.
