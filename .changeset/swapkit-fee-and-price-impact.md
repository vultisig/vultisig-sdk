---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Surface the affiliate fee SwapKit itemizes on EVM routes, and expose a route's price impact on `GeneralSwapQuote`.

The SwapKit EVM branch never populated `affiliateFee`, although the Solana branch already did, so an aggregator swap reached consumers with no swap fee to show and a total that omitted it. It now carries the fee, staying absent when the response itemizes none so consumers can report the fee as part of the quoted rate rather than asserting a zero. Resolution failures on this branch degrade to no fee instead of throwing: the figure is display-only there, unlike on Solana where the tx type requires it.

`GeneralSwapQuote.priceImpact` carries a route's signed fractional price impact, read from SwapKit's `meta.priceImpact` and falling back to `totalSlippageBps`. It is absent for providers that publish no impact, so consumers can hide the row instead of substituting a fee figure for it.
