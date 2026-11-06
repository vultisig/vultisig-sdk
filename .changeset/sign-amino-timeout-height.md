---
'@vultisig/mpc-types': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Sign a dApp amino sign doc's tx-level `timeout_height`. `SignAmino` gains an optional `timeoutHeight`, the Cosmos signing input carries it when it is set and non-zero, and `SignAminoInput` accepts it. Without it the chain rejected the signature for any dApp that sets a timeout (Osmosis).
