---
'@vultisig/cli': patch
---

Classify a Cosmos DeliverTx execution failure honestly, and journal its on-chain hash.

A Cosmos transaction can be included in a block and still fail execution (DeliverTx code !== 0 — out-of-gas, a wasm revert, a THORChain/Maya deposit-handler rejection). The SDK now surfaces that truthfully (cosmjs `assertIsDeliverTxSuccess`, #1316), but the CLI mishandled it:

- **Classification.** The DeliverTx-failure message (`Error when broadcasting tx <hash> at height <N>. Code: <c>; Raw log: <log>`) did not match the CheckTx-shaped classifier, so it fell through to `EXTERNAL_SERVICE` (exit 6, retryable) with a "the node may be temporarily unavailable / Retry" hint — for a transaction that is on-chain and has failed. It now classifies as `INVALID_INPUT` (exit 4, non-retryable) with an honest message: the transaction was included on-chain and its execution failed, the on-chain result is authoritative — inspect it via the hash and rebuild rather than blindly re-broadcasting the identical bytes. The chain is resolved from the SDK broadcast wrapper (never from wrapped payload text), so a foreign chain's program log cannot spoof the marker and strand a genuinely-retryable error.

- **Journaling.** On the direct `send` / `swap` guard, a DeliverTx failure previously journaled nothing (the throw preceded hash computation), discarding a hash we definitively have. The guard now records the hash cosmjs embedded in the message as a broadcast plus a `failed` resolution, so the transaction is on the record (tx-status / explorer / audit) while the guard correctly re-opens for a legitimate retry. Gated on the intent's own (trusted) chain so a non-Cosmos error can't get a spoofed hash journaled.
