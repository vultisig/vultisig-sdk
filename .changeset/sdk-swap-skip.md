---
"@vultisig/sdk": minor
---

add `sdk.swap.skip` — Skip Go cross-chain route + unsigned-tx prep. Exposes `runSkipSwap`, `quoteSkipRoute`, `buildSkipAffiliates`, `skipChainIdToChainName`, `resolveLuncFloorUsd`, `SkipApiError`, `SKIP_AFFILIATE_ADDRESS_BY_CHAIN`, `DEFAULT_LUNC_NOTIONAL_FLOOR_USD` and the related types (`SkipSwapArgs`, `SkipSwapOutcome`, `SkipSwapSuccess`, `SkipSwapErrorEnvelope`, `SkipUnsignedMsg`, `SkipChainIdsToAffiliates`). Quotes a Skip route and builds the unsigned EVM/cosmos tx envelope for the caller's signing layer — never signs, never broadcasts. Also corrects the canonical dYdX cosmos chain id (`dydx-1` -> `dydx-mainnet-1`).
