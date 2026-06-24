---
'@vultisig/sdk': minor
---

Add `sdk.price.get` (`getPrice`) and `sdk.price.batch` (`getPricesBatch`) — token USD pricing via CoinGecko through the Vultisig proxy. Resolves a USD price (+ 24h change + market cap) across four read-only routes: explicit CoinGecko coin id, EVM contract + chain, Solana mint, or native ticker (via the ported `NATIVE_COINGECKO_IDS` map). Pure-crypto: never returns a fabricated price — a lookup failure throws. `getPricesBatch` fans out in parallel and isolates per-query failures (`{ ok: false, error }`) so one unpriceable token can't sink the batch, with results in input order. Also exports `isKnownNativePriceSymbol`, `symbolFromCoinGeckoId`, `coinGeckoIdToSymbol`, and the `NATIVE_COINGECKO_IDS` map. Ported from the mcp-ts `get_price` price-oracle.
