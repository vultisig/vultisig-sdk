---
'@vultisig/sdk': patch
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

UTXO sends (Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash) whose recipient amount is below the chain's dust floor are now refused before signing with the minimum named in the error, instead of building an unrelayable transaction. Additionally, a UTXO transaction plan that fails (dust, insufficient funds, or any other planner error) now fails with that error instead of being retried as a send-max transaction.
