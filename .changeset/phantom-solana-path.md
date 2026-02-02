---
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

feat: add Phantom wallet Solana derivation path support

When importing a seedphrase, the SDK now detects if the mnemonic was originally created in Phantom wallet by checking both the standard Solana BIP44 path and Phantom's non-standard path (`m/44'/501'/0'/0'`).

**SDK changes:**
- `discoverChainsFromSeedphrase()` now returns `ChainDiscoveryAggregate` with `results` and `usePhantomSolanaPath` flag
- Added `usePhantomSolanaPath` option to `createFastVaultFromSeedphrase()`, `createSecureVaultFromSeedphrase()`, and `joinSecureVault()`
- Auto-detection during chain discovery: uses Phantom path when it has balance and standard path doesn't

**CLI changes:**
- Added `--use-phantom-solana-path` flag to `create-from-seedphrase fast` and `create-from-seedphrase secure` commands

**Examples:**
- Added Phantom Solana path toggle checkbox in SeedphraseImporter component
