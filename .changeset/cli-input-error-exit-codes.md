---
'@vultisig/cli': patch
---

CLI input errors (missing amount, unsupported destination tag, missing XRP tag, unknown token, invalid slippage, invalid execute message, missing import file) now exit 4 (`INVALID_INPUT`); a wrong vault password exits 2 (`AUTH_REQUIRED`) with a clear message; commander usage errors are emitted as the JSON error envelope in JSON mode; `INVALID_ADDRESS.context.address` carries the full address.
