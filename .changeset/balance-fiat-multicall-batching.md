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
values concurrently. `getTotalValue` now fetches chains' values concurrently
with a bounded number in flight (no unbounded RPC burst on many-chain vaults)
instead of awaiting them one chain at a time.

`getEvmChainBalances` now OMITS a coin whose balance it could not read (a reverted/failed
Multicall3 sub-call, or a per-coin failure in the no-multicall3 fallback) instead of decoding it
as `0n`. A present `0n` means a genuine zero balance; an absent key means "unknown". Callers can
therefore tell the two apart and refetch instead of persisting a fabricated zero.

`FiatValueService.updateValues('all')` now bounds its per-chain fan-out with the same concurrency
cap as `getTotalValue` instead of a raw `Promise.all`.

Fix: a coin OMITTED from the EVM multicall result (a transient RPC hiccup /
partial Multicall3 aggregate) is no longer cached as a fabricated `0n` (5-min
TTL) and no longer emitted as a real `balanceUpdated` — which would have shown a
real 0 for a coin the user owns. Only keys the multicall actually returned are
cached/emitted (a genuine `0n` is a real balance and is kept); a missing key
falls through uncached so the next call refetches it.
