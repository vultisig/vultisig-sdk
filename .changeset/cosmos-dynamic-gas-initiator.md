---
"@vultisig/core-mpc": patch
---

feat(cosmos): initiator-side dynamic gas — simulate native sends and relay `CosmosSpecific.gas_limit`

`getCosmosChainSpecific` now simulates native Cosmos bank sends via
`/cosmos/tx/v1beta1/simulate` and relays the padded (`× 1.3`) `gas_used` to
co-signers in `CosmosSpecific.gas_limit`. The signing-inputs resolver already
honors this field (scaling the fee amount accordingly) and falls back to the
static per-chain gas limit when it is absent or zero, so:

- Only native bank sends are simulated (a relayed dapp `signData`, token / IBC /
  contract / staking txs, and vault-based chains keep the static limit).
- Estimation fails closed: any simulate/build error leaves the field unset, so
  simulation never blocks signing and peers converge on the static limit.
- The relayed limit is part of the SignDoc every device hashes; because it is
  computed with exact integer math (ceil of `gas_used × 13 / 10`) and honored
  identically across peers, cross-device co-signing stays byte-identical.

Mirrors the iOS `CosmosGasEstimator` implementation.
