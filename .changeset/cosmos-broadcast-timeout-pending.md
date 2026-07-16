---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Return the Cosmos transaction hash when CosmJS accepts a broadcast but times out waiting for indexing, leaving confirmation to status polling instead of reporting broadcast failure.
