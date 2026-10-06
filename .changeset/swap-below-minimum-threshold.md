---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Below-minimum swap quotes now report the computed minimum input (when THORChain can route the pair) in the error message and in `SwapError.details`, and the SDK raises them as `InvalidAmount` instead of `InvalidConfig`; the CLI exits 4 (`INVALID_INPUT`) with `error.context.minimum` instead of 1.
