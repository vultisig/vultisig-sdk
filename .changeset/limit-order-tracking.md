---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Limit-order tracking primitives: queue client, outcome resolution, and a shared status model.

`getLimitSwapQueue`/`parseLimitSwapQueue` read THORNode's `/thorchain/queue/limit_swaps` (sender-scoped — one call covers all of an address's orders) into typed resting orders: fill split, TTL, trade target, and the target asset as THORChain holds it after fuzzy-match expansion. An absent `limit_swaps` key parses as `null` ("no information"), never as an empty queue — an order's disappearance from this list is what marks it terminal, so a response we didn't understand must not close every tracked order at once.

`resolveLimitSwapOutcome`/`classifyLimitSwapActions` answer what happened to an order that left the queue, from Midgard `/v2/actions`. A `refund` action's reason is authoritative regardless of its outbound status, and — verified live on mainnet — a *filled* limit order indexes as a refund reading `"swap has been completed."` with no swap-type action at all, so the completion stem classifies as `filled` rather than degrading to `refunded`. Rate limits, server errors and empty responses are all `unresolved`: an answer THORChain hasn't given, never an outcome.

`getThorchainTxResult` reads `/cosmos/tx/v1beta1/txs/{hash}` — the only place a rejected `MsgDeposit` is visible, since it never produces a Midgard action — so a rejected placement cannot sit "pending" forever.

`limitSwapOrderStatuses` + `isTerminalLimitSwapOrderStatus` give every platform the same order lifecycle to render.
