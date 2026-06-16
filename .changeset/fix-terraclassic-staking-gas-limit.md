---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

cosmos/gas: bump TerraClassic staking gas limit from 2M to 3M and cap msgCount scaling

`getCosmosStakingGasLimit` now returns 3M for `Chain.TerraClassic` regardless of `msgCount`. The previous 2M base caused consistent out-of-gas failures (`ValuePerByte` meter in the classic-terra treasury/tax post-handler adds ~200-800 gas beyond the standard SDK estimate). The msgCount scaling is disabled for TerraClassic: at `msgCount >= 2` the scaled gasWanted would exceed the 100 LUNC fee floor, causing node rejection. Columbus-5 callers must split multi-validator reward claims into separate transactions.
