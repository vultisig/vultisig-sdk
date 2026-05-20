---
'@vultisig/core-chain': minor
---

cosmos/staking: add `getCosmosValidators` and `getCosmosValidator` LCD query helpers, plus their URL builders (`getValidatorsUrl`, `getValidatorUrl`) and typed response models (`Validator`, `ValidatorStatus`, `ValidatorDescription`, `ValidatorCommission`).

`getCosmosValidators` auto-paginates the staking module's validator set with an optional `status` filter (typically `BOND_STATUS_BONDED` for staking-picker UIs) and a 50-page runaway cap. `getCosmosValidator` resolves a single valoper. Both work across every `IbcEnabledCosmosChain` — same paths, same response shape — and accept an optional `fetchImpl` / `signal` for testing and abortability.

These complete the staking-module read surface: callers can now list validators, list a delegator's delegations / unbondings / rewards, and resolve any individual valoper, all without a Stargate dependency.

cosmos/gas: add `getCosmosStakingGasLimit({ chain, msgCount })` alongside the existing `getCosmosGasLimit`. The defaults in `getCosmosGasLimit` are calibrated for `bank.MsgSend` / `ibc.MsgTransfer` and run out of gas mid-execution for native staking msgs — most visibly on TerraClassic, where an empirically observed `MsgDelegate` burned 400_659 gas against the 400_000 default. The new helper exposes per-chain limits sized for `MsgDelegate` / `MsgUndelegate` / `MsgBeginRedelegate` / `MsgWithdrawDelegatorReward` and scales by `msgCount` for bulk-claim multi-msg txs.
