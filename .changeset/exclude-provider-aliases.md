---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(swap): accept returned quote provider ids in `findSwapQuote.excludeProviders`

`findSwapQuote.excludeProviders` now accepts both display names (`CowSwap`, `KyberSwap`, `LiFi`) and returned quote provider ids (`cowswap`, `kyber`, `li.fi`) for general providers. Unknown exclude tokens now fail closed instead of silently leaving the provider eligible.
