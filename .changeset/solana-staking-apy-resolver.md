---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(solana): staking APY resolver

Phase 6 of Solana native staking. Adds `resolveValidatorApy` under
`@vultisig/core-chain/chains/solana/staking/apyResolver`, which drives the
per-validator APY on the DeFi stake rows. Two sources, in order: the Stakewiz
`apy_estimate` passthrough (network-measured, commission-net) from the Phase 2
metadata seam, then an on-chain fallback derived from the network inflation rate
and the fraction of supply staked, net of the validator's commission, compounded
over the epochs-per-year. Returns `undefined` when neither yields a positive
value so the view hides the APY row.
