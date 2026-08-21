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

Also (review): fixed the change-output boundary asymmetry — `change === dustLimit`
exactly is a standard, relayable output under Bitcoin's own `value < threshold =>
dust` rule, but the change gate used a strict `>` and folded an exactly-at-the-floor
change output into the miner fee instead of paying it back to the sender. Now `>=`,
matching the primary-send guard's own boundary. Reworded the dust-limit error
message to "SDK's conservative dust floor" rather than "dust limit" — `spec.dustLimit`
is sized for the chain's canonical `scriptType`, not derived from the recipient
address's actual decoded script type, so it can both under- and over-reject
depending on the recipient's script type; a refused caller shouldn't be handed a
number that overclaims precision it doesn't have. A fully per-script-type-derived
floor (per review) is a real follow-up, not done in this pass.
