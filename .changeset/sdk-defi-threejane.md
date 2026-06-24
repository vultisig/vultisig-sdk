---
'@vultisig/sdk': minor
---

Add `sdk.defi.threeJane` — the first protocol under the new `sdk.defi.*` surface. Builds the unsigned 2-step Ethereum transaction sequence (ERC-20 approve + `Helper.deposit`) to supply USDC into 3Jane and mint the senior `USD3` or staked junior `sUSD3` share. Build-only / pure-crypto: returns unsigned calldata, performs no network IO, never signs or broadcasts. Also exported from the React Native entry point.
