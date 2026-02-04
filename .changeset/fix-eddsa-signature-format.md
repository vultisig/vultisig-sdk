---
"@vultisig/sdk": patch
---

Fix EdDSA signature verification failure for Solana and other EdDSA chains

The signature format conversion was corrupting EdDSA signatures by round-tripping through DER encoding. EdDSA signatures now store raw r||s format directly, preserving the correct endianness from keysign.

Affected chains: Solana, Sui, Polkadot, Ton, Cardano
