---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Add the Kamino Earn data layer under `chains/solana/kamino`: a REST client for the kVaults API (vault state, metrics, user positions, PnL) with a typed error envelope that separates retryable statuses from permanent refusals; a curated vault registry pinning each launch vault's identity (mints, decimals, farm, curator, risk tier); distinct token- and share-denominated amount types over exact `bigint` base units, with exact-rate conversions that truncate toward zero so a sized withdraw can never over-request (the API rewrites an over-sized withdraw to `u64::MAX` — withdraw everything); vault-info hydration that refuses responses disagreeing with the pinned identity and derives the effective deposit/withdraw minimums the on-chain program actually accepts; and position parsing with a spendable-balance rule that stays strictly below the reported balance.
