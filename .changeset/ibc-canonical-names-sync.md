---
'@vultisig/sdk': patch
---

Fix `supportedIbcDestinationsFrom()` rejecting canonical Vultisig chain names (`Osmosis`, `Cosmos`, etc.) that `prepareIbcTransfer()` already accepts for the same `fromChain` input. Both entry points now route the source chain through `normaliseIbcChainId()`, so route discovery and transfer building agree on what counts as a valid source chain.
