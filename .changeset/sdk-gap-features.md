---
"@vultisig/sdk": minor
---

Add SDK gap features for extension migration: token registry (getKnownTokens, getKnownToken, getFeeCoin), price feeds (getCoinPrices), security scanning (scanSite, validateTransaction, simulateTransaction), fiat on-ramp (getBanxaSupportedChains, getBuyUrl), token discovery (discoverTokens, resolveToken), and CosmosMsgType constants. All features use SDK-owned types decoupled from core internals.
