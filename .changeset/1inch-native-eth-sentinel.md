---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix 1inch swap quotes to native ETH (and other EVM chains' native assets) failing route resolution.

`findSwapQuote`'s 1inch fetcher passed `from.id ?? from.ticker` / `to.id ?? to.ticker` into
`getOneInchSwapQuote`, so a native asset (no `.id`) fell back to its ticker string (e.g. `"ETH"`).
`getOneInchSwapQuote`'s `isFeeCoin` check relies on `undefined` to detect the native asset and
substitute 1inch's `0xEeee...` sentinel address (EIP-7528) — a truthy ticker string defeated that
check, so 1inch received `dst=ETH` (or `src=ETH`) instead of the sentinel and rejected the request
with `dst must be an Ethereum address`. This silently removed 1inch as a route for any swap
involving a chain's native asset (e.g. USDC→ETH), even though 1inch could otherwise fill it.

Now `findSwapQuote` forwards the coin's raw `.id` (`undefined` for the native asset) so
`getOneInchSwapQuote`'s existing sentinel-mapping logic works as designed. ERC-20↔ERC-20 quotes
are unaffected; other providers (Kyber, LiFi, SwapKit) construct their own requests and are not
touched by this change.
