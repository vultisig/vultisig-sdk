---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(swap): support an external recipient for native + CowSwap swaps

`findSwapQuote` now accepts an optional `recipient` address. When set, the
swapped output is routed to that address via the native THORChain/MayaChain
memo `destination` and the CowSwap order `receiver`. Aggregators that would pay
the swap initiator (1inch, KyberSwap, LiFi, SwapKit) are skipped for
custom-recipient swaps so funds are never silently misrouted. When `recipient`
is omitted, routing and payout are unchanged.

Part of wiring the Advanced Swap settings (vultisig/vultisig-windows#4131);
external recipient for the remaining aggregators is a follow-up.
