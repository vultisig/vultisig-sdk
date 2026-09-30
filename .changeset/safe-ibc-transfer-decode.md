---
"@vultisig/sdk": patch
---

Decode direct IBC transfers through the shared bytes decoder, preserving receiver, amount, and denomination. Fail closed on non-empty packet memos, unrepresented forwarding fields, and unsupported packet encodings that may conceal destination routing or execution.
