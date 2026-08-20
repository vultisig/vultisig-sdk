---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `chains.cardano.getCardanoExtendedUtxos` and the `CardanoExtendedUtxo` type on the curated React Native SDK entry so downstream consumers can reuse the canonical asset-aware Cardano UTXO fetcher instead of maintaining app-local Koios overlays.
