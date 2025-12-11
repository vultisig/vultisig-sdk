---
"@vultisig/sdk": minor
---

**BREAKING**: Change fast vault creation API to return vault from verification

- `createFastVault()` now returns `Promise<string>` (just the vaultId)
- `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
- Vault is only persisted to storage after successful email verification
- If process is killed before verification, vault is lost (user recreates)

This is a cleaner API - the user only gets the vault after it's verified and persisted.
