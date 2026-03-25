---
"@vultisig/sdk": patch
---

Fix Tron broadcast: use secp256k1Extended key type for 65-byte uncompressed public keys, and check the Tron API response for broadcast errors instead of silently succeeding
