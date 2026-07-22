---
'@vultisig/sdk': patch
'@vultisig/cli': patch
'@vultisig/client-shared': minor
---

Route the CLI version cache, version output, and VaultStateStore local state through `VULTISIG_CONFIG_DIR` so they stay co-located with SDK vault storage and other shared CLI state.
