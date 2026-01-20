---
"@vultisig/cli": minor
---

Update CLI to support SDK vault creation API changes

**Breaking Changes:**
- Renamed `import-seedphrase` command to `create-from-seedphrase` to match SDK naming
  - `vultisig import-seedphrase fast` → `vultisig create-from-seedphrase fast`
  - `vultisig import-seedphrase secure` → `vultisig create-from-seedphrase secure`

**New Features:**
- Added `join secure` command to join existing SecureVault creation sessions
  - Supports QR payload via `--qr`, `--qr-file`, or interactive prompt
  - Auto-detects if mnemonic is required based on session type
  - Example: `vultisig join secure --qr "vultisig://..."`

**Internal Changes:**
- Updated SDK API calls to use new method names:
  - `importSeedphraseAsFastVault` → `createFastVaultFromSeedphrase`
  - `importSeedphraseAsSecureVault` → `createSecureVaultFromSeedphrase`
- Renamed internal functions and types to match SDK naming conventions
