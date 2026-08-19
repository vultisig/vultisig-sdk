---
"@vultisig/sdk": patch
---

Add a dust-floor check on the primary output amount in `buildUtxoSendTx`, failing closed before address decoding, fee calculation, or an MPC signing ceremony instead of only at broadcast.
