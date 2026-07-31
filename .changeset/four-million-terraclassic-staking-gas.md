---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

cosmos/gas: raise the TerraClassic staking gas limit from 3M to 4M

`getCosmosStakingGasLimit` now returns 4M for `Chain.TerraClassic` regardless of `msgCount`, giving external SDK consumers headroom over the observed 2,501,503-gas `MsgBeginRedelegate` path.
