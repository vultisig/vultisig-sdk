---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

cosmos/gas: raise the TerraClassic staking gas limit from 3M to 4M

`getCosmosStakingGasLimit` now returns 4M for `Chain.TerraClassic` regardless of `msgCount`, giving external SDK consumers headroom over the observed 2,501,503-gas `MsgBeginRedelegate` path.

Also exports `TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS`, the `uluna` fee correctly priced for this 4M staking gas limit (113.3 LUNC at the chain's 28.325 uluna/gas minimum). The existing `TERRA_CLASSIC_ULUNA_BASE_GAS` / `getCosmosSendFeeBaseUnits` fee is priced for the 300k native-send gas limit and under-pays a 4M-gas staking tx by ~13x, so consumers must pair the staking gas limit with this new constant, not the send fee.
