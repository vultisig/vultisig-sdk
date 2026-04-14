---
"@vultisig/sdk": patch
---

React Native platform entry now exports typed wrappers for `getPublicKey`, `deriveAddress`, `isValidAddress`, and `getCoinType` that accept `WalletCoreLike` from `@vultisig/walletcore-native` instead of `WalletCore` from `@trustwallet/wallet-core`. Consumers no longer need `as unknown as` casts at the SDK boundary. Also re-exports the `WalletCoreLike` type for convenience.
