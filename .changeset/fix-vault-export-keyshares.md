---
"@vultisig/sdk": patch
---

fix: preserve keyshares in VaultBase constructor when provided via parsedVaultData

Previously, the VaultBase constructor always set `keyShares: { ecdsa: '', eddsa: '' }` for lazy loading, ignoring any keyshares passed in `parsedVaultData`. This caused exported vault files to be missing keyshare data (~700 bytes instead of ~157KB), making them unusable for signing or re-import.

The fix preserves keyshares from `parsedVaultData` when available, falling back to empty strings for lazy loading only when keyshares aren't provided.
