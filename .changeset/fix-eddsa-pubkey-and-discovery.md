---
"@vultisig/sdk": patch
---

Fix EdDSA public key derivation and ChainDiscoveryService issues

- Fix `deriveChainKey` to use correct public key type for EdDSA chains (Solana, Sui, Polkadot, Ton use ed25519, Cardano uses ed25519Cardano)
- Fix timeout cleanup in ChainDiscoveryService to prevent unhandled rejections and memory leaks
- Add guard against zero/negative concurrencyLimit to prevent infinite loop
