---
'@vultisig/sdk': patch
---

fix(utxo): reject a below-dust primary send amount before signing

`buildUtxoSendTx` only applied `spec.dustLimit` to the *change* output (via
`serializeOutputs`); the primary send amount was never dust-checked. A send
below the chain's dust limit would build an unrelayable/rejected output and burn
an MPC signing ceremony on a transaction that can never confirm. Added an early
`if (opts.amount < spec.dustLimit) throw` right after the existing
zero/negative-amount guard, before any sighash work.
