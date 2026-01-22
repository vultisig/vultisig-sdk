---
"@vultisig/sdk": minor
---

feat(sdk): rename seedphrase import APIs and add joinSecureVault method

**Breaking Changes:**
- `importSeedphraseAsFastVault()` → `createFastVaultFromSeedphrase()`
- `importSeedphraseAsSecureVault()` → `createSecureVaultFromSeedphrase()`
- Type renames: `ImportSeedphraseAsFastVaultOptions` → `CreateFastVaultFromSeedphraseOptions`, etc.

**New Features:**
- `joinSecureVault(qrPayload, options)` - Programmatically join SecureVault creation sessions
  - Auto-detects keygen vs seedphrase mode from QR payload's `libType` field
  - For keygen sessions: no mnemonic required
  - For seedphrase sessions: `mnemonic` option required and must match initiator's

**Documentation:**
- Updated README.md with new method names and `joinSecureVault()` API docs
- Updated SDK-USERS-GUIDE.md with new section "Joining a SecureVault Session"
