---
'@vultisig/sdk': patch
---

Re-encrypt successfully imported legacy vault backups with the salted PBKDF2 format before persistence and emit a typed security notice recommending password rotation and replacement of old backup files.
