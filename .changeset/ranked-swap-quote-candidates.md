---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Add `findSwapQuotes`, returning the full ranked swap-route candidate set (`{ best, ranked }`) alongside the auto-selected winner, so consumers can offer route selection. Each ranked entry carries the fully bound quote (request amount, expiry, safety fingerprint), its provider name, and the comparable net output used for ranking. `findSwapQuote` now delegates to it and its behavior — selection, preference band, and every error path — is unchanged.
