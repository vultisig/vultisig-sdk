---
'@vultisig/sdk': patch
---

Collapse balance and fiat-value N+1 request fan-out into batched calls.

`BalanceService.getBalances({ includeTokens: true })` previously issued one
`getCoinBalance` RPC per token on a chain (native + N tokens = N+1 round-trips).
EVM chains now fetch native + all tokens in a single Multicall3 call via
`getEvmChainBalances`, respecting the existing per-coin BALANCE cache (only
uncached coins are multicalled) and caching/emitting each result exactly as
`getBalance` does. Non-EVM chains keep the per-coin path, and the built-in
Multicall3 fallback covers EVM chains without a multicall3 contract.

`FiatValueService.getValues` looped `getValue` per token, each triggering a
single-id `getErc20Prices` request; it now warms the price cache with one
batched `getErc20Prices` call for the whole chain and resolves native + token
values concurrently. `getTotalValue` now fetches every chain's values in
parallel instead of awaiting them one chain at a time.
