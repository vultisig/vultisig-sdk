---
'@vultisig/core-chain': patch
---

Fix the QBTC send broadcast reporting a false success on a DeliverTx failure. `broadcastQbtcTx` uses `BROADCAST_MODE_SYNC`, which only surfaces the CheckTx (mempool-admission) code — a DeliverTx execution failure (out-of-gas, revert) still returns `code: 0` at broadcast time — and the resolver returned success after only that check, with no inclusion poll. It also read `data.tx_response?.code && …`, treating a missing `tx_response` as success. The resolver now polls for inclusion and re-checks the DeliverTx `code` (mirroring the QBTC claim helper, whose `waitForTxInclusion` is extracted to a shared `waitForQbtcTxInclusion`): a confirmed DeliverTx failure throws a non-retryable error, an unconfirmable inclusion (timeout / transient RPC error) is left in-flight for the status resolver, and a missing/failed CheckTx code is verified by hash instead of trusted.
