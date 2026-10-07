---
'@vultisig/cli': patch
---

CLI input errors (missing amount, unsupported destination tag, missing XRP tag, unknown token, invalid slippage, invalid execute message, missing import file) now exit 4 (`INVALID_INPUT`); import pre-check failures including `EACCES` and `EISDIR` map to `INVALID_INPUT`, and missing-file text identifies the failing `stat`; a wrong vault password or corrupted vault data exits 2 (`AUTH_REQUIRED`) with clear recovery guidance; commander usage errors are emitted as the JSON error envelope in JSON mode; `INVALID_ADDRESS.context.address` carries the full address.
