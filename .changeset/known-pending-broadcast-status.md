---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Mark unknown EVM and Cosmos transaction hashes as `isKnown: false` so broadcast verification rethrows real broadcast failures instead of treating unindexed hashes as known pending transactions.
