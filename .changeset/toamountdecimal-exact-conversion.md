---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

fix(swap): exact bigint decimal conversion for the displayed swap output (`toAmountDecimal`) — the float64 `fromChainAmount(...).toFixed()` path silently drifted above 2^53 raw units (e.g. `999999999999999999999999` @18dp rendered as `1000000.000000000000000000`), so the amount the user confirmed could differ from the quoted one. Non-integer provider amount strings keep the legacy fallback instead of throwing mid-build.
