---
"@vultisig/sdk": patch
---

Export the vault-free Cosmos staking/distribution LCD queries
(`getCosmosDelegations`, `getCosmosDelegatorRewards`,
`getCosmosUnbondingDelegations`, `getCosmosVestingAccount`, the URL
builders, and their types) from the React Native entry point. They
were already in the generic entry but the hand-curated RN allow-list
omitted them, forcing RN consumers (vultiagent-app) to hand-roll an
LCD client for delegations/rewards. Additive only; signing primitives
remain via `chains.cosmos.buildCosmosStakingTx`.
