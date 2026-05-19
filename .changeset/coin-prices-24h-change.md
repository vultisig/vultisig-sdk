---
"@vultisig/sdk": minor
---

feat(price): add `Vultisig.getCoinPricesWithChange` returning 24h % change

`getCoinPrices` returns only `Record<string, number>` (spot price), so
consumers that need the 24h change — e.g. a price widget's −3.97%
indicator — had to keep a side-channel CoinGecko call, duplicating the
SDK and risking drift.

Adds a parallel, additive path:

- `Vultisig.getCoinPricesWithChange(params)` →
  `Record<string, { price: number; change24h?: number }>`
- core-chain `getCoinPricesWithChange` / `queryCoingeickoPricesWithChange`
  (requests `include_24hr_change=true`; `change24h` is omitted when
  CoinGecko has no datum for an id)
- new public types `CoinPriceWithChange`, `CoinPricesWithChangeResult`

Deliberately a **separate function**, not a flag on `getCoinPrices`:
`getCoinPrices` / `CoinPricesResult` / `FiatValueService` /
`fiatToAmount` / `getErc20Prices` are byte-for-byte unchanged — zero
regression surface on the existing call sites. Price-only callers should
keep using `getCoinPrices` (lighter payload, stable contract); reach for
`getCoinPricesWithChange` only when the change is actually rendered.

Lets vultiagent-app (and any other client) drop its hand-rolled
`fetchPrices` 24h-change side-channel and source price+change from the
SDK alone.
