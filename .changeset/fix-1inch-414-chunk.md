---
"@vultisig/sdk": patch
---

fix(evm): chunk the 1inch token-metadata request so token-rich wallets don't 414. `findEvmCoins` joined every held-token address into one `/custom` GET, overflowing the proxy URI (HTTP 414) and killing discovery of all tokens; requests are now batched (50/req) and non-fatal per batch.
