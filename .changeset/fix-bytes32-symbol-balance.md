---
'@vultisig/sdk': patch
---

Fix `getEvmBalances` failing on ERC-20 tokens whose `symbol()` returns a legacy bytes32 (e.g. MKR) instead of a dynamic string, aborting the whole balance batch.
