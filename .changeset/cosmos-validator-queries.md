---
'@vultisig/core-chain': minor
---

cosmos/staking: add `getCosmosValidators` and `getCosmosValidator` LCD query helpers, plus their URL builders (`getValidatorsUrl`, `getValidatorUrl`) and typed response models (`Validator`, `ValidatorStatus`, `ValidatorDescription`, `ValidatorCommission`).

`getCosmosValidators` auto-paginates the staking module's validator set with an optional `status` filter (typically `BOND_STATUS_BONDED` for staking-picker UIs) and a 50-page runaway cap. `getCosmosValidator` resolves a single valoper. Both work across every `IbcEnabledCosmosChain` — same paths, same response shape — and accept an optional `fetchImpl` / `signal` for testing and abortability.

These complete the staking-module read surface: callers can now list validators, list a delegator's delegations / unbondings / rewards, and resolve any individual valoper, all without a Stargate dependency.
