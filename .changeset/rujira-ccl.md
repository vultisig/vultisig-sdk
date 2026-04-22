---
'@vultisig/rujira': minor
---

feat(rujira): CCL (Custom Concentrated Liquidity) support

Rujira shipped [Custom Concentrated Liquidity](https://rujira.network/trade) on RUJI Trade
on 2026-04-20. This release adds SDK support for range-position management on
`rujira-fin` pair contracts via a new `range` ExecuteMsg variant.

New surface:

- **`client.range: RujiraRange`** — pure builders (no signer needed):
  - `buildCreatePosition({ pairAddress, config, base, quote })`
  - `buildDeposit({ pairAddress, idx, base, quote })`
  - `buildWithdraw({ pairAddress, idx, share })`
  - `buildClaim({ pairAddress, idx })`
  - `buildTransfer({ pairAddress, idx, to })`
  - `buildWithdrawAll({ pairAddress, idx })` — returns `RangeMultiTransactionParams`
    with `[claim, withdraw('1')]`. Callers MUST sign + broadcast both msgs in a
    single cosmos tx for atomicity (`wasm_execute_multi`).

- **GraphQL helpers** (against `api.vultisig.com/ruji/api/graphql`):
  - `client.range.getPositions(owner)` — list all range positions
  - `client.range.getPosition(pairAddress, idx)` — single position analytics
  - `client.range.getPairAddress(base, quote)` — resolve FIN pair contract
    from tickers / denoms (exact-match preferred, single-candidate fuzzy
    match fallback; ambiguous hits throw `INVALID_PARAMS`)

- **`@vultisig/rujira/ccl` subpath export** — CCL math module ported from
  rujira-ui (MIT): linear + quadratic weight models, √price Newton-Raphson
  price recovery, bucket distribution generator. 90 tests pass.

- **`@vultisig/rujira/range` subpath export** — just the RujiraRange class
  + types for consumers that want to avoid pulling the full entry point.

- **`RujiraErrorCode.INVALID_PARAMS`** — new error code for the input
  validation surface (Decimal12 for config fields, Decimal4 + `(0, 1]` for
  withdraw share, `idx` strictly `/^\d+$/`, `thor1` prefix on pair addresses).

No change to existing `swap` / `orderbook` / `staking` / `ghost` / `deposit` /
`withdraw` / `discovery` surfaces.
