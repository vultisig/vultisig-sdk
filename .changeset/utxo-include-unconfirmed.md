---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
'@vultisig/client-shared': minor
'@vultisig/cli': minor
'@vultisig/mcp': minor
---

Add opt-in `includeUnconfirmed?: boolean` support (default `false`) for listing and spending unconfirmed (mempool) UTXOs across UTXO send, fee-estimation, max-send, UTXO RPC helpers, CLI (`vultisig send --include-unconfirmed`), MCP `send` tool, and Browser/Electron example send forms (`getUtxos`, `getUtxoBalance`, `getKeysignUtxoInfo`, `buildSendKeysignPayload`, `getSendFeeEstimate`, `prepareSendTxFromKeys`, `getMaxSendAmountFromKeys`, `TransactionBuilder`, `VaultBase`). Default behavior remains confirmed-only with no breaking changes or protobuf schema modifications.
