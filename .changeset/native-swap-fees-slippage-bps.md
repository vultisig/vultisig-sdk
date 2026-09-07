---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Move `slippage_bps` on a native swap quote from the top level into `fees`, where THORChain and MayaChain actually send it.

`NativeSwapQuote.slippage_bps` was never populated: THORChain's `QuoteSwapResponse` has no such property, and its `QuoteFees` schema declares `slippage_bps` as a required integer. MayaChain's spec agrees. Because the field was optional, every consumer reading it silently got `undefined` rather than a compile error — which is how the price-impact row went missing in the desktop app and extension.

`NativeSwapFees` now carries `slippage_bps?: number`, and the phantom top-level field is gone so the wrong read cannot compile. This is a type-only change; `getNativeSwapQuote` already spreads the response through verbatim, so no runtime behavior changes.

Note that `slippage_bps` is the price impact alone and is not interchangeable with the neighbouring `total_bps`, which is the total fee relative to the amount out.
