---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(solana): staking foundation — models + RPC read layer

Phase 1 of Solana native staking. Adds the chain-layer read foundation under
`@vultisig/core-chain/chains/solana/staking`: config, stake-account/validator
models (jsonParsed parsing + activation-state derivation), the RPC read layer
(getVoteAccounts / stake-account scan / epoch / rent / inflation / supply), and
the withdraw cooldown gate. No UI, no signing, no validator-metadata source.
