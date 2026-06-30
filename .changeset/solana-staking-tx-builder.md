---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(solana): native-staking transaction builder (byte-parity)

Phase 3 of Solana native staking. Adds the signing core for the delegate flow
(and the proto for the later unstake / withdraw / move-stake ops) under
`@vultisig/core-chain/chains/solana/staking/tx`:

- `stakingPayload` — discriminated staking-op intent (delegate / unstake /
  withdraw / move-stake deactivate + redelegate sub-steps).
- `buildUnsignedStakingTx` — maps a payload to the wallet-core Solana stake
  proto (`delegateStakeTransaction` derives the stake account; move-redelegate
  sets it explicitly), compiles a zero-signature envelope via
  `TransactionCompiler`, and returns it base64-encoded. This is the MPC
  byte-parity contract: the initiating device builds these bytes once (pinning
  the recent blockhash + the derived stake-account address) and relays them via
  `signSolana.rawTransactions`, so every co-signer signs the identical message.

Adds `long` to core-chain deps (Long-typed proto amount fields). Byte-parity
tests build delegate / deactivate / withdraw / move-redelegate txs against real
wallet-core, decode them back, and assert determinism.
