---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Add opt-in `includeUnconfirmed?: boolean` support (default `false`) for listing and spending unconfirmed (mempool) UTXOs across UTXO send, fee-estimate, max-send, and UTXO RPC helpers (`getUtxos`, `getUtxoBalance`, `getKeysignUtxoInfo`, `buildSendKeysignPayload`, `getSendFeeEstimate`, `prepareSendTxFromKeys`, `getMaxSendAmountFromKeys`, `TransactionBuilder`, and `VaultBase`). Default behavior remains confirmed-only with no breaking changes or protobuf schema modifications.
