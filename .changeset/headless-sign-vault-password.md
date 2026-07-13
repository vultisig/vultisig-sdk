---
'@vultisig/cli': patch
---

Fix `agent ask` headless signing so a vault unlocked via `VAULT_PASSWORD` (or the OS keyring) can sign without also passing `--password`. The sign-time gate now keys off whether a password is actually needed — an encrypted vault that is still locked with no password in hand — and retries the same non-interactive chain (cache → keyring → `VAULT_PASSWORDS`/`VAULT_PASSWORD`) before prompting, instead of always re-prompting when `--password` was absent. Unencrypted vaults skip the gate entirely. The transaction confirmation gate is unchanged. Also corrects the `VAULT_PASSWORD` help text.
