---
"@vultisig/cli": minor
---

Add `tx-status` command to check transaction confirmation status

Polls every 5 seconds until the transaction reaches a final state (success/error). Use `--no-wait` to return the current status immediately. Supports all output modes (table, JSON, silent) and the interactive shell.
