---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix the Sui broadcast reporting a false success for a transaction that aborted on-chain (sdk#1398). `broadcastSuiTx` called `executeTransactionBlock` without requesting effects, so a tx that executed but aborted (MoveAbort / InsufficientGas) resolved with a digest — an RPC-level success that is not execution success — and was returned as a successful broadcast. It now requests `showEffects` and throws when `effects.status.status === 'failure'`, mirroring the Sui status resolver. An RPC-level error still falls through to `verifyBroadcastByHash` unchanged.
