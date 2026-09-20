---
"@vultisig/core-chain": major
"@vultisig/core-mpc": major
"@vultisig/sdk": patch
"@vultisig/walletcore-native": minor
---

Use prefix-aware WalletCore SS58 constructors for Bittensor address derivation and transaction destinations, including native iOS and Android bridges. Reject destinations with a different network prefix or invalid account data.

Direct callers of `buildBittensorSigningPayload` must pass their initialized WalletCore as the second argument. Direct callers of `refineBittensorChainSpecific` must provide `walletCore` in the input. High-level SDK signing and fee estimation pass the existing runtime automatically.
