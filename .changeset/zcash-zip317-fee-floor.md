---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Add a canonical ZIP-317 conventional-fee module to core-chain and floor the Zcash send-builder fee at 5,000 zats per logical action, so low fee rates can no longer produce transactions the network rejects with "tx unpaid action limit exceeded".
