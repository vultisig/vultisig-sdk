---
'@vultisig/client-shared': patch
'@vultisig/cli': patch
---

Consolidate `VULTISIG_CONFIG_DIR` resolution into a shared helper so empty or whitespace-only overrides consistently fall back to the default config directory across credentials, config storage, token cache, and broadcast journal paths.
