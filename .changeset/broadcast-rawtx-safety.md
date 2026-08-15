---
'@vultisig/sdk': patch
'@vultisig/cli': major
---

Normalize `broadcast --raw-tx` before submission, escape control characters in the confirmation preview, and document Tron JSON payloads alongside the other supported raw-transaction encodings.

**Breaking (CLI):** `vultisig broadcast --raw-tx ...` now requires an interactive confirmation or an explicit `--yes` flag before submitting — it previously broadcast immediately with no gate. Unattended/scripted callers (CI, automation, agent wrappers) that invoke `broadcast` without a TTY must add `--yes`, or they will now get a `ConfirmationRequiredError` (exit 12) instead of a broadcast.
