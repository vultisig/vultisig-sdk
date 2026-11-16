---
'@vultisig/sdk': patch
---

`FastVault` and `SecureVault` now wrap a failed key-share decryption during lazy share loading (for example `export()` with a wrong cached password) in `VaultError(InvalidConfig, 'Failed to unlock vault: …')` instead of leaking the raw AES-GCM `Error`.
