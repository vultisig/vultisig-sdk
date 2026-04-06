---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Classify vault import failures with specific `VaultImportErrorCode` values (`INVALID_FILE_FORMAT`, `INVALID_PASSWORD`, `UNSUPPORTED_FORMAT`, `CORRUPTED_DATA`) instead of wrapping most errors as `CORRUPTED_DATA`. Add unit tests for import edge cases.
