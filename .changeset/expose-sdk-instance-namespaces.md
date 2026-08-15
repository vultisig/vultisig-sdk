---
'@vultisig/sdk': minor
---

Expose `sdk.balance`, `sdk.bridge`, `sdk.cosmos`, `sdk.decode`, `sdk.gas`, `sdk.prep`, `sdk.price`, and `sdk.swap` as instance namespace getters on `Vultisig`, matching the ergonomic already established by `sdk.defi` and documented repeatedly in the CHANGELOG (`sdk.balance.evm`, `sdk.swap.skip`, `sdk.prep.cosmosStaking`, etc). Previously only the root/module exports existed for these helper families — `new Vultisig()` had no matching instance handle, so code written against the documented `sdk.balance.getEvmBalances(...)` shape failed at runtime with `undefined is not a function`.

`sdk.balance` and `sdk.swap` intentionally exclude a small subset of helpers (Polkadot balance reads, the Jupiter same-chain-Solana builder, and the Skip Go cross-chain builder) that are not yet proven safe as static imports on the shared `Vultisig` class bundled for React Native (they eagerly pull `@polkadot/api` / `@solana/web3.js`, which crash Hermes at module init). `sdk.prep` similarly excludes `buildSplTransfer` and a handful of other prep helpers pending the same audit. All excluded helpers remain reachable via their existing flat exports.
