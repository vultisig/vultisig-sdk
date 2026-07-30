---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Make the SDK's default Node/Electron `FileStorage` honor `VULTISIG_CONFIG_DIR` so default vault storage stays co-located with the CLI config, credentials, cache, and broadcast journal paths.
