---
'@vultisig/sdk': patch
'@vultisig/cli': patch
'@vultisig/rujira': patch
---

fix: address PR review bugs and safety issues

- Fix missing ChromeExtensionPolyfills import causing build failure
- Fix floating-point precision loss in CLI amount parsing for high-decimal tokens
- Fix BigInt crash on non-integer amount strings in swap validation
- Fix Number exponentiation precision loss in VaultSend formatAmount
- Use VaultError with error codes in chain validation instead of generic Error
- Add chainId mismatch validation in signAndBroadcast
- Add hex string input validation in hexDecode
- Guard against empty accounts array in client getAddress
- Use stricter bech32 THORChain address validator in deposit module
