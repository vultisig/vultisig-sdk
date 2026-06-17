---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

fix(swap): validate recipient and slippage overrides in findSwapQuote

`findSwapQuote` now trims the optional `recipient` and treats empty/whitespace
strings as no recipient, so a blank value no longer gates off initiator-paying
aggregators or gets forwarded as a native `destination` / CowSwap `receiver`.
It also rejects an invalid `slippageTolerance` (negative, `NaN`, or non-finite)
up front with a `SwapError` instead of letting the bad value propagate into
every provider call.
