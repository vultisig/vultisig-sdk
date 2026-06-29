---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(solana): validator-metadata seam (Stakewiz, swappable)

Phase 2 of Solana native staking. Adds a swappable off-chain enrichment seam for
validator display metadata (name / logo / APY estimate / score) on top of the
Phase 1 on-chain `getVoteAccounts` rows, under
`@vultisig/core-chain/chains/solana/staking/metadata`:

- `ValidatorMetadataProvider` — provider interface; contract: never throws.
- `stakewizProvider` — concrete impl over api.stakewiz.com (`apy_estimate`
  percent→fraction, `image`→logo, `wiz_score`→score). Degrades to an empty map
  on any outage / non-OK / parse error so callers fall back to on-chain-only.
- `enrichValidators` — merges the metadata map onto the validator rows; the
  provider is injectable for tests.
