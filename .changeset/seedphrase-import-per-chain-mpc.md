---
"@vultisig/sdk": minor
---

Add per-chain MPC key import for feature parity with vultisig-windows

Seedphrase import now runs MPC key import for each chain's derived key, matching vultisig-windows behavior. This ensures imported vaults have chain-specific key shares that can be used for signing.

**Changes:**
- `MasterKeyDeriver.ts`: Add `deriveChainPrivateKeys()` method for batch chain key derivation
- `FastVaultSeedphraseImportService.ts`: Add per-chain MPC import loop, fix lib_type to use KEYIMPORT (2)
- `SecureVaultSeedphraseImportService.ts`: Add per-chain MPC import loop, include chains in QR KeygenMessage

**How it works:**
For N chains, import runs N+2 MPC rounds:
1. Master ECDSA key via DKLS
2. Master EdDSA key via Schnorr
3. Each chain's key via DKLS (ECDSA chains) or Schnorr (EdDSA chains)

The vault now includes `chainPublicKeys` and `chainKeyShares` populated with results from per-chain MPC imports.
