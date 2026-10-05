---
'@vultisig/core-chain': minor
'@vultisig/sdk': patch
---

Report which contract-price lookups failed, and cap a multi-batch CoinGecko fetch at 20 seconds. `getErc20Prices` still returns the price map.
