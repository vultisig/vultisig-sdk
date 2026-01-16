---
"@vultisig/sdk": minor
---

Add SignAmino and SignDirect Cosmos SDK signing methods

This release adds support for custom Cosmos transaction signing with two new methods:

- `vault.prepareSignAminoTx()` - Sign using the legacy Amino (JSON) format
- `vault.prepareSignDirectTx()` - Sign using the modern Protobuf format

These methods enable governance votes, staking operations, IBC transfers, and other custom Cosmos transactions across all supported Cosmos SDK chains (Cosmos, Osmosis, THORChain, MayaChain, Dydx, Kujira, Terra, TerraClassic, Noble, Akash).

New exported types:
- `SignAminoInput`, `SignDirectInput`
- `CosmosMsgInput`, `CosmosFeeInput`, `CosmosCoinAmount`
- `CosmosSigningOptions`
