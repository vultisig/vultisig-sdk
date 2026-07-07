---
"@vultisig/sdk": patch
---

fix(evm): one token's on-chain metadata failure no longer kills all discovery. `getDiscoveredEvmCoin` re-threw inside `findEvmCoins`' `Promise.all`, so a single transient metadata read rejected discovery of every token on the chain; it now skips just the failing token.
