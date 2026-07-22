---
'@vultisig/core-chain': minor
'@vultisig/sdk': patch
---

Expose `getThorchainMemoAsset`, a `Coin` -> THORChain memo-asset converter, plus `isThorchainRoutable` and `isThorchainSecuredAssetId`, from `@vultisig/core-chain/swap/native/thorchainMemoAsset`.

`buildLimitSwapMemo` takes `source_asset` / `target_asset` as pre-formatted THORChain notation, but nothing produced those strings from a `Coin`. Market swaps never needed it — the memo comes back on the server quote — but limit swaps build the memo locally, so every consumer had to derive the notation itself. Since the memo *is* the order, a divergence there misroutes funds.

Notation is derived from `toNativeSwapAsset`, the converter the market-swap path already uses, so the package has exactly one definition of a THORChain asset string. The only thing layered on top is abbreviating an L1 contract to its last 6 characters: memo bytes are capped at 80 on UTXO sources, while the swap API is given the full address. Secured assets are left un-abbreviated because the trailing address is part of the denom that identifies them.

`limitSwapMemo`'s prefix -> chain map is now derived by inverting the new chain -> prefix map rather than being hand-maintained alongside it, so the two directions cannot drift. Behaviour is unchanged — the inversion reproduces the previous map exactly.

`@vultisig/sdk` is bumped because it bundles `packages/core/chain` source rather than depending on the published package, so it needs a fresh tarball to carry this change. The helper is not re-exported from the SDK's public API, hence a patch rather than a minor.

Note: `buildLimitSwapMemo` still does not accept secured assets — its `assertValidPoolId` check requires dotted `CHAIN.ASSET` notation and rejects the `CHAIN-ASSET` form. That gap predates this helper (iOS has the same one) and is tracked separately; a regression test pins it so it cannot change silently.
