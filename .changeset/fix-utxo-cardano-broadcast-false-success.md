---
"@vultisig/sdk": patch
---

fix: UTXO/Cardano broadcast no longer reports false success on a genuine failure

`broadcastCardanoTx`/`broadcastUtxoTx` bucketed `BadInputsUTxO` (a genuine failure — spent/invalid inputs)
together with benign MPC-race duplicates (`txn-mempool-conflict`/`already known`) and returned success
unconditionally for all three, bypassing the on-chain hash verification safety net. Every ambiguous submit
error now routes through `verifyBroadcastByHash`, and `getUtxoTxStatus` now sets `isKnown: false` when the
hash is genuinely not found (matching the existing convention already used by the cosmos/evm/polkadot/
ripple/solana resolvers) so a real failure correctly rethrows instead of being swallowed as success.
