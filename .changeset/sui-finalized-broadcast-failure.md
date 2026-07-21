---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix `RawBroadcastService`'s Sui raw-broadcast path reporting a false success for a transaction that failed on-chain (sdk#1398). It called `executeTransactionBlock` without requesting effects, so a tx that reverted (MoveAbort / InsufficientGas) resolved with a digest — an RPC-level success that is not execution success — and was returned as broadcast. It now requests `showEffects` and asserts the effects status via the shared `assertSuiTxSucceeded` helper (extracted from the `broadcastSuiTx` resolver, which already guarded against this), throwing a non-retryable error on a failed execution instead of reporting success.
