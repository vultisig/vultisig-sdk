---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

chore(rujira): remove dead `fetchMergeableTokenBalances` and `fetchStakeView` GraphQL clients

Both had zero callers repo-wide:
- `fetchMergeableTokenBalances` queried the KUJI to RUJI merge GraphQL field; that merge window closed 2026-04-05 and nothing invokes it.
- `fetchStakeView` (exported as `fetchRujiraStakeView`) queried Rujira's `stakingV2` field but was never wired into any staking read path, and its result shape lacks the APR field the live staking read actually returns.

Also drops `rujiraGraphQlEndpoint` and the `RujiraStakeView` type from `config.ts` now that both are orphaned by the deletion. No behavior change for any consumer — this is pure dead-code removal.
