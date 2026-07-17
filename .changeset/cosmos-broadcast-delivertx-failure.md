---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Stop reporting Cosmos broadcast as successful when the transaction is included on-chain but execution failed (DeliverTx code !== 0), and make sure the broadcast retry wrapper never misreads that failure as a transient transport error and resends it.
