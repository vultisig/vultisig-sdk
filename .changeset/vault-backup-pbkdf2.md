---
"@vultisig/lib-utils": minor
"@vultisig/core-mpc": minor
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

Password-protected vault backups use PBKDF2-HMAC-SHA256 with a random salt (600k iterations by default) and a versioned blob prefix; legacy SHA-256-only backups still decrypt.
