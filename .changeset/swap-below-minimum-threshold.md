---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Below-minimum swap quotes now report the computed minimum input when THORChain can route the pair and the submitted amount is below that floor. The error identifies it as the THORChain route minimum on multi-provider pairs and exposes it in `SwapError.details`; the SDK raises these errors as `InvalidAmount` instead of `InvalidConfig`, and the CLI exits 4 (`INVALID_INPUT`) with `error.context.minimum` instead of 1.
