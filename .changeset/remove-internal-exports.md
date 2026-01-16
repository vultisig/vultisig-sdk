---
"@anthropic/vultisig-sdk": minor
---

Remove internal-only exports from public API for GA launch

Removed exports that were implementation details not intended for SDK users:
- `FastSigningInput` - internal signing type
- `MasterKeyDeriver` - internal key derivation class
- `ChainDiscoveryService` - internal chain discovery class
- `SeedphraseValidator` - internal class (use `validateSeedphrase()` function instead)
- `cleanMnemonic` - internal utility function
- `FastVaultSeedphraseImportService` - internal service
- `SecureVaultSeedphraseImportService` - internal service
- `DerivedMasterKeys` - internal type

Users should use the `Vultisig` class methods for seedphrase import operations instead of these internal services.
