---
'@vultisig/sdk': patch
---

Make `decodeFromToolResult` reject malformed hex/base64 payload strings instead of silently coercing them into different bytes before decode. This keeps the shared tx-decoder fail-closed on truncated or non-canonical payload input.
