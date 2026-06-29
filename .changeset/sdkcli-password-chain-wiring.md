---
'@vultisig/cli': patch
---

agent: resolve the vault password from the keyring/env chain before prompting

`vultisig agent` (including `agent ask` and `--via-agent`) now resolves the vault
password from the in-memory cache → OS keyring (`vsig auth setup`) →
`VAULT_PASSWORDS`/`VAULT_PASSWORD` env chain before falling back to an
interactive prompt. Headless operators who configured the keyring or env no
longer have to pass `--password` on argv (which exposed the secret to `ps` and
shell history). `--password` still works but is de-emphasized and now emits a
stderr warning pointing at the keyring/env path.
