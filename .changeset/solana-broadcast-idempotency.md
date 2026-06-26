---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(core-chain): treat duplicate-signature Solana broadcast errors as idempotent success

`broadcastSolanaTx` now classifies "already been processed" / `AlreadyProcessed`
rejections from `sendRawTransaction` as an idempotent success (returns instead
of routing to `verifyBroadcastByHash`), mirroring the TON/UTXO/Cosmos dedupe
guards. This stops a headless retry after an ambiguous broadcast from blindly
re-submitting an already-accepted Solana transaction.
