---
"@vultisig/sdk": patch
---

Fix seedphrase import portfolio showing zero balances

After importing a seedphrase with detected balances, portfolio was showing zero balances because chain-specific public keys from the MPC import were not being used for address derivation.

**Root cause:** BIP44 derivation paths contain hardened levels (e.g., `m/44'/60'/0'`) which cannot be derived from a public key alone. Chain-specific public keys must be stored during import (when private keys are available) and used later for address derivation.

**Fixes:**
- `VaultBase.ts`: Preserve `chainPublicKeys` and `chainKeyShares` when loading vaults
- `AddressService.ts`: Pass `chainPublicKeys` to `getPublicKey()` for correct address derivation
- `Vultisig.ts`: Set imported chains as active chains so portfolio shows relevant chains

**Backwards compatible:** Non-import vaults (regular fast/secure, imported shares) are unaffected as they fall back to master key derivation when `chainPublicKeys` is undefined.
