---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

feat(swap): support a custom slippage tolerance in findSwapQuote

`findSwapQuote` now accepts an optional `slippageTolerance` (in percent, e.g.
`0.5` = 0.5%). It is forwarded to the general aggregators that accept a slippage
override, each converted to that provider's native unit: 1inch and SwapKit
(percent), KyberSwap (basis points), and LiFi (fraction). CowSwap (RFQ limit
order) and the native THORChain/MayaChain protocols use their own protection
and ignore it. When omitted, every provider keeps its existing default — no
behavior change.

Part of wiring the Advanced Swap settings (vultisig/vultisig-windows#4131).
