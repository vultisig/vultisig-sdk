---
'@vultisig/sdk': patch
'@vultisig/core-chain': patch
---

UTXO sends (Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash) whose recipient amount is below the chain's dust floor are now refused before signing with the minimum named in the error, instead of building an unrelayable transaction.
