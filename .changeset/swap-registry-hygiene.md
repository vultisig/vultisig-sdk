---
"@vultisig/core-chain": patch
"@vultisig/sdk": minor
---

Swap surface hygiene: SwapService.getQuote now forwards affiliateConfig (per-provider fee-owner overrides) to core findSwapQuote instead of silently dropping it - the field is added to SwapQuoteParams, default behavior unchanged when omitted. The swapEnabledChains aggregate now unions every provider list (kyber/jupiter/cowswap were missing, complete only by accident via LiFi's superset), and kyberSwapEnabledChains drops Zksync/Blast, which Kyber's API 404s on.
