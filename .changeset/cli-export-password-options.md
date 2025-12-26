---
"@vultisig/cli": minor
---

feat: separate unlock and export passwords in CLI export command

The export command now has two distinct password options:
- `--password`: Unlocks the vault (decrypts stored keyshares for encrypted vaults)
- `--exportPassword`: Encrypts the exported file (defaults to `--password` if not specified)

This fixes the "Password required but callback returned empty value" error when exporting encrypted vaults.

Password resolution now uses an in-memory cache that persists across SDK callbacks, allowing the CLI to pre-cache the unlock password before vault loading.
