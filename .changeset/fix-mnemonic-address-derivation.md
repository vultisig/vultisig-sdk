---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Derive seedphrase-scan addresses the same way the vault does. `deriveAddressFromMnemonic` used WalletCore's `getAddressForCoin`, so MayaChain came out as a `thor1…` address (Maya shares THORChain's coin type), Bittensor came out as a Polkadot address, and Bitcoin Cash kept the `bitcoincash:` prefix. The Maya balance lookup failed with "invalid Bech32 prefix; expected maya, got thor", which blocked chain discovery during seedphrase import.
