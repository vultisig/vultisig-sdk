---
"@vultisig/sdk": patch
---

Reject empty and whitespace-only `fromContractAddress` and `toContractAddress` in `buildJupiterSwapTx` before resolving fees or requesting a quote. Callers that used blank strings for native SOL must now omit the parameter or pass `SOL_NATIVE_MINT`. Nonblank mint addresses continue to be trimmed.
