---
"@vultisig/sdk": minor
---

feat(utxo): OP_RETURN output in buildUtxoSendTx so UTXO THOR swaps carry the swap memo

Adds an optional `opReturnData` (UTF-8) to `BuildUtxoSendOptions`. When present,
`buildUtxoSendTx` appends a trailing 0-value OP_RETURN output carrying the memo,
enabling UTXO (DOGE/BTC/LTC/BCH) THORChain swaps: without the on-chain memo
THORChain cannot route the vaulted deposit, so the app currently fails closed on
these.

Fund-safety:

- The OP_RETURN is built inside `serializeOutputs`, so it feeds the outputs
  digest every sighash variant consumes (BIP143 / legacy / Zcash). Every input
  signature commits to the memo - it cannot be stripped or altered post-signing.
- The recipient (vault) output keeps the FULL amount; the OP_RETURN is a separate
  0-value output and its size is folded into the fee estimate, so the fee comes
  from inputs/change, never by shaving the vault output.
- Payload is capped at the 80-byte standard-relay limit (direct push <= 75 bytes,
  OP_PUSHDATA1 for 76..80); larger memos throw rather than build a non-standard,
  unbroadcastable tx.
