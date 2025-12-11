---
"@vultisig/example-browser": patch
"@vultisig/cli": patch
---

Update browser example and CLI for new fast vault creation API

- Updated to use new `createFastVault()` that returns just the vaultId
- Updated to use new `verifyVault()` that returns the FastVault
- Removed `code` from CLI `CreateVaultOptions` (verification code always prompted interactively)
- Removed `--code` option from CLI create command
