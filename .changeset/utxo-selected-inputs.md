---
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
'@vultisig/client-shared': minor
'@vultisig/cli': minor
'@vultisig/mcp': minor
---

Add opt-in candidate-pool UTXO selection (`selectedUtxos?: readonly ChainPlainUtxo[]`) across all UTXO chains (`Bitcoin`, `BitcoinCash`, `Litecoin`, `Dogecoin`, `Dash`, `Zcash`) in `buildSendKeysignPayload`, `getSendFeeEstimate`, `prepareSendTxFromKeys`, `getMaxSendAmountFromKeys`, `TransactionBuilder`, `VaultBase`, CLI (`vultisig send --utxo <txid:vout:satoshis>`), MCP `send` tool, and Browser/Electron example send UI. When omitted, behavior is unchanged; when provided, on-chain UTXO/balance fetches are skipped and input selection / MAX calculations run strictly within the validated candidate pool, with zero breaking changes or protobuf schema modifications.
