---
'@vultisig/cli': patch
---

`vultisig portfolio` no longer rewrites the vault's currency preference: `--currency` is a per-call display override and plain `portfolio` uses the stored preference, including in the interactive shell. Invalid stored preferences fall back to USD. Only `vultisig currency <code>` changes it. `vultisig currency` with no argument now honours `--output json` and reports `updated: false`.
