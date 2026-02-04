---
"@vultisig/sdk": patch
---

fix(sdk): fix SecureVault relay signing for EdDSA chains

- Fix QR payload to include full transaction details using `getJoinKeysignUrl` from core
- Fix chainPath derivation using `getChainSigningInfo` adapter
- Fix EdDSA signature format: use raw r||s (128 hex chars) instead of DER encoding

Affected chains: Solana, Sui, Polkadot, TON, Cardano
