---
'@vultisig/sdk': patch
'@vultisig/cli': patch
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

UTXO sends (Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash) whose recipient amount is below the chain's static dust floor are now refused before signing with the minimum named in the error; fee-rate-dependent dust rejections above that floor instead explain that the current network dust threshold requires a larger amount. Additionally, a UTXO transaction plan that fails (dust, insufficient funds, or any other planner error) now fails authoritatively with that error instead of being retried as a send-max transaction, and deterministic dust or balance failures surface to CLI consumers as invalid input. Max-send and max-swap fee estimates now request a max spend explicitly instead of relying on the removed retry.

An amount above the available balance now fails with an insufficient-balance error instead of being planned as a max spend.
