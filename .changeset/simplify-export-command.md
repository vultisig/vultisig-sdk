---
"@vultisig/cli": patch
---

Simplify export command by removing `--encrypt` and `--no-encrypt` flags. Password is now optional - if provided, vault is encrypted; if omitted or empty, vault is exported without encryption. Path argument now supports directories (appends SDK-generated filename).
