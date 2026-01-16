---
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

Add seedphrase (BIP39 mnemonic) import functionality

This release adds the ability to import existing wallets from BIP39 mnemonic phrases (12 or 24 words) into Vultisig vaults, mirroring the iOS implementation.

**New SDK Methods:**
- `sdk.validateSeedphrase()` - Validate a BIP39 mnemonic phrase
- `sdk.discoverChainsFromSeedphrase()` - Discover chains with balances before import
- `sdk.importSeedphraseAsFastVault()` - Import as FastVault (2-of-2 with VultiServer)
- `sdk.importSeedphraseAsSecureVault()` - Import as SecureVault (N-of-M multi-device)

**Features:**
- Chain discovery with progress callbacks to find existing balances
- Auto-enable chains with balances during import
- EdDSA key transformation using SHA-512 clamping for Schnorr TSS compatibility
- Full ECDSA (secp256k1) and EdDSA (ed25519) master key derivation

**New exported types:**
- `SeedphraseValidation`, `ChainDiscoveryProgress`, `ChainDiscoveryResult`
- `ChainDiscoveryPhase`, `DerivedMasterKeys`
- `ImportSeedphraseAsFastVaultOptions`, `ImportSeedphraseAsSecureVaultOptions`
- `SeedphraseImportResult`

**New services:**
- `SeedphraseValidator` - BIP39 validation using WalletCore
- `MasterKeyDeriver` - Key derivation from mnemonic
- `ChainDiscoveryService` - Balance scanning across chains
- `FastVaultSeedphraseImportService` - FastVault import orchestration
- `SecureVaultSeedphraseImportService` - SecureVault import orchestration

**New CLI Commands:**
- `vultisig import-seedphrase fast` - Import as FastVault (2-of-2 with VultiServer)
- `vultisig import-seedphrase secure` - Import as SecureVault (N-of-M multi-device)

**CLI Features:**
- Secure seedphrase input (masked with `*`)
- `--discover-chains` flag to scan for existing balances
- `--chains` flag to specify chains (comma-separated)
- Interactive shell support with tab completion
- Progress spinners during import
