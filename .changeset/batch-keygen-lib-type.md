---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Fast vaults created with `tssBatching: true` can now be fast-signed. `setupVaultWithServer` now sends `lib_type: DKLS` to `/vault/batch/keygen`. Before, VultiServer stored the vault as GG20, and every fast sign timed out after 3 minutes.
