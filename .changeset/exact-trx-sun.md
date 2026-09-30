---
"@vultisig/sdk": patch
"@vultisig/core-chain": patch
---

Preserve every digit in TRX balances with the new exact `balanceSunRaw` string and format `balanceTrx` from it. Keep `balanceSun` as a best-effort number for compatibility; it may round above `Number.MAX_SAFE_INTEGER` SUN (approximately 9.007 billion TRX). Reject invalid or duplicate account balance tokens while preserving existing TRON routing.
