---
"@vultisig/sdk": patch
---

Add SDK-level chain validation to catch invalid enum values (e.g. "BitcoinCash" vs Chain.BitcoinCash) with descriptive error messages. Fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver. Fix SwapService crash on general swap quotes by unwrapping SwapQuote wrapper to access the inner discriminated union.
