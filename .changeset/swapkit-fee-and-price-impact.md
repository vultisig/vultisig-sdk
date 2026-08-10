---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Surface the affiliate fee SwapKit itemizes on EVM routes, and expose a route's price impact on `GeneralSwapQuote`.

The SwapKit EVM branch never populated `affiliateFee`, although the Solana branch already did, so an aggregator swap reached consumers with no swap fee to show and a total that omitted it. It now carries the fee. It stays absent when no amount can be vouched for — no fee entries, an itemized zero, or a shape that cannot be resolved — so consumers report the fee as part of the quoted rate rather than asserting a zero. Unresolvable shapes raise the new `SwapKitFeeShapeError`, which this branch swallows because the fee is not part of the signed EVM transaction; Solana still lets it throw, since its tx type requires the fee.

`GeneralSwapQuote.priceImpactFraction` carries a route's signed price impact as a fraction, read from SwapKit's `meta.priceImpact` and falling back to `totalSlippageBps`. Both are narrowed to finite numbers, since nothing validates the proxy's JSON on the way in. The unit is named in the field because the neighbouring price-impact guard exposes both fraction and percent entry points, and mixing them is a silent 100x. The field is absent for providers that publish no impact, so consumers can hide the row instead of substituting a fee figure for it.
