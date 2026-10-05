---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

QBTC on a vault without an ML-DSA key: `chains --add-all` now skips it and reports why, `chains --add QBTC` fails closed, `addresses` lists it under `failures` instead of printing a stack trace, and `balance QBTC` reports a non-retryable invalid-input error with the `add-mldsa` hint. The SDK gains `vault.addressesDetailed()` and `vault.getUnderivableChains()`.
