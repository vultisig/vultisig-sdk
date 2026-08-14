---
'@vultisig/sdk': patch
---

Reject malformed hex and base64 strings in `decodeFromToolResult` instead of allowing `Buffer` to normalize them into different bytes.
