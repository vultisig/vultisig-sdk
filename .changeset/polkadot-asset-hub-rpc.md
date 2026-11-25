---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Polkadot USDT and USDC balances load again. `assetHubRpcUrl` pointed at the `/dot-ah/` proxy, which now returns 404, so every Asset Hub token balance read failed. Since the Asset Hub migration, the `/dot/` proxy serves Polkadot Asset Hub, where native DOT and the `pallet_assets` tokens both live, so `assetHubRpcUrl` now uses that same endpoint. This fixes `getPolkadotCoinBalance` for tokens and `sdk.balance.polkadot({ address, assetId })`.
