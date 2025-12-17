---
"@vultisig/cli": patch
---

Fix password prompt being swallowed by spinner during signing

- Add `--password` option to `send` and `swap` commands for non-interactive use
- Pre-unlock vault before signing spinner starts to prevent prompt interference
- Password prompt now appears before spinner when not provided via CLI flag
