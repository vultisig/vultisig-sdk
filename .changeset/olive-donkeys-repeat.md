---
'@vultisig/cli': patch
---

Correct the non-EVM permanent broadcast classification so it only declares a failure permanent when the fault is in the signed bytes themselves.

- Cosmos: `insufficient funds` (5), `insufficient fee` (13) and `unknown address` (9) are no longer permanent. A CheckTx rejection does not increment the account sequence, so these stay replayable verbatim once the account is funded, a cheaper node accepts the fee, or the account exists — they now classify as retryable (`EXTERNAL_SERVICE`, exit 6) instead of `INVALID_INPUT`, exit 4.
- UTXO: dropped matching on bitcoind's `-26`/`-27` reject codes. Blockchair is the only UTXO broadcast backend and does not preserve those codes — it reformats the node's reply as `Invalid transaction. Error: <reason>` — so the branch never fired, and `-26` is a bucket that also covers recoverable rejections (`non-final`, `too-long-mempool-chain`, `min relay fee not met`) that must not be stranded.
- Chain detection now reads the SDK's own wrapper rather than scanning the whole error text for any ` on <chain>:` substring, so chain-labelled text inside a wrapped payload (e.g. a Solana program log) can no longer route an error to another family's vocabulary.

EVM classification and the exit 9/13 broadcast-safety semantics are unchanged.
