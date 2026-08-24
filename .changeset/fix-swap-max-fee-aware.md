---
'@vultisig/sdk': minor
---

`vault.swap({ amount: 'max' })` now resolves `max` through the fee-aware `maxSwapable` its own quote already computes, instead of committing the full source balance. A native max swap previously over-committed by exactly the network fee and failed at prepare/broadcast with insufficient funds, after the caller had been told the swap was viable. Routes that cannot price their source-chain fee at quote time (deposit-channel transfers) now fail closed with an actionable error rather than building against a balance that is not safe to spend. This matches what `send({ amount: 'max' })` has always done.
