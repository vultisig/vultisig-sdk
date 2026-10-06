---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

QBTC on a vault without an ML-DSA key: `chains --add-all` now preserves enabled chains and reports underivable ones as `skipped` or `unavailable`, `chains --add QBTC` fails closed, `addresses` lists it under `failures` instead of printing a stack trace, and `balance QBTC` reports a non-retryable invalid-input error with a vault-aware hint. The SDK gains `vault.addressesDetailed()` and `vault.getUnderivableChains()`, and `vault.addChain()` / `vault.setChains()` now reject newly added chains that the vault cannot derive.
