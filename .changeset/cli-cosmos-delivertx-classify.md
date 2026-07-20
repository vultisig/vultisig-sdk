---
'@vultisig/cli': patch
---

Classify a Cosmos DeliverTx execution failure honestly, and journal its on-chain hash.

A Cosmos transaction can be included in a block and still fail execution (DeliverTx code !== 0 — out-of-gas, a wasm revert, a THORChain/Maya deposit-handler rejection). The SDK now surfaces that truthfully (cosmjs `assertIsDeliverTxSuccess`, #1316), but the CLI mishandled it:

- **Classification.** The DeliverTx-failure message (`Error when broadcasting tx <hash> at height <N>. Code: <c>; Raw log: <log>`) did not match the CheckTx-shaped classifier, so it fell through to `EXTERNAL_SERVICE` (exit 6, retryable) with a "the node may be temporarily unavailable / Retry" hint — for a transaction that is on-chain and permanently failed. It now classifies as `INVALID_INPUT` (exit 4, non-retryable) with an honest message: the tx executed and failed on-chain, the account sequence is consumed and the gas is spent, so re-broadcasting the identical signed bytes cannot succeed. This is non-retryable regardless of the SDK code — the opposite posture from the same code on the CheckTx path (where e.g. code 5 stays retryable because it never touched the chain).

- **Journaling.** On the direct `send` / `swap` guard, a DeliverTx failure previously journaled nothing (the throw preceded hash computation), discarding a hash we definitively have. The guard now records the hash cosmjs embedded in the message as a broadcast plus a `failed` resolution, so the terminal transaction is on the record (tx-status / explorer / audit) while the guard correctly re-opens for a legitimate fresh-sequence rebuild.
