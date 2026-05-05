---
"@vultisig/core-chain": patch
---

Rank swap quotes by comparable destination-token amount across eligible providers instead of using the first successful provider. Native THORChain/Maya quotes are re-based from swap API precision (`getNativeSwapDecimals`) to the destination coin decimals before comparison with aggregator `dstAmount`.
