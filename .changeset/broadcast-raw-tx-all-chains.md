---
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

feat(sdk): add broadcastRawTx() for broadcasting pre-signed transactions

Adds `broadcastRawTx()` method supporting all chain families:
- EVM: Ethereum, Polygon, BSC, Arbitrum, Base, etc. (hex-encoded)
- UTXO: Bitcoin, Litecoin, Dogecoin, etc. (hex-encoded)
- Solana: Base58 or Base64 encoded transaction bytes
- Cosmos: JSON `{tx_bytes}` or raw base64 protobuf (10 chains)
- TON: BOC as base64 string
- Polkadot: Hex-encoded extrinsic
- Ripple: Hex-encoded transaction blob
- Sui: JSON `{unsignedTx, signature}`
- Tron: JSON transaction object

CLI commands added:
- `vultisig sign --chain <chain> --bytes <base64>` - sign pre-hashed data
- `vultisig broadcast --chain <chain> --raw-tx <data>` - broadcast raw tx

Documentation updated with complete workflow examples for EVM, UTXO, Solana, and Sui.
