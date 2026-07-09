---
'@vultisig/cli': patch
---

fix(cli): honor VULTISIG_CONFIG_DIR for vault storage

The documented `VULTISIG_CONFIG_DIR` env var was a no-op for vault storage: the
CLI constructed the SDK without a storage override, so vaults, the active-vault
pointer and cache always resolved to `~/.vultisig` even when the var pointed
elsewhere — only `config.json` and the agent journal honored it, producing a
split-brain config location that broke CI/container isolation and multi-tenant
use. The CLI now roots SDK vault storage at `getConfigDir()` via a shared
`createVaultStorage()` helper. When the var is unset it falls back to
`~/.vultisig`, so the default location is unchanged.
