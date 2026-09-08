---
'@vultisig/sdk': patch
---

Reject UTXO recipient amounts below the chain and recipient script's default dust threshold before preparing signing data. Preserve address-validation precedence and include Dogecoin's required fee surcharge for recipients below 0.01 DOGE in transaction building and coin selection. Fee estimation accepts an optional recipient amount for that surcharge.
