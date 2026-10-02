---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
---

feat(keysign): say which asset a send is short of

`BuildKeysignPayloadError` can carry a `shortfall` (`required`, `available`,
`ticker`, `decimals`, `includesNetworkCosts`) so a consumer can tell the user
exactly which asset is missing and by how much instead of a generic "not
enough funds". It is attached where both amounts are known: the generic amount
refinement (amount + fee + retained balance against the balance) and the UTXO
paths where the requested amount alone exceeds the UTXO balance. The TON
gasless relay refusal and a fee-driven UTXO planner failure carry none.
`core-chain` exports `getSendRetainedBalance`, the balance a native send must
keep back (the Bittensor existential deposit), shared with
`getMaxSendableAmount`.
