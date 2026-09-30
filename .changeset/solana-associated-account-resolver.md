---
"@vultisig/sdk": minor
"@vultisig/core-chain": patch
---

Export `getSplAssociatedAccount` from the SDK and React Native entrypoints. Resolve only the deterministic associated token account for legacy SPL and Token-2022 mints, independent of RPC account order. The resolver throws when that account is absent; pass its `isToken2022` result to `buildSplTransfer` for the same wallet and mint.
