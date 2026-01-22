# @vultisig/cli

## 0.3.0

### Minor Changes

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`cc4e5fd`](https://github.com/vultisig/vultisig-sdk/commit/cc4e5fd2ff83bcce1723435107af869a43ea069f) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update CLI to support SDK vault creation API changes

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

### Patch Changes

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`fee3f37`](https://github.com/vultisig/vultisig-sdk/commit/fee3f375f85011d14be814f06ff3d7f6684ea2fe) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address CodeRabbit PR #71 review suggestions

  **Critical fixes:**
  - JoinSecureVaultService: require `devices` parameter instead of defaulting to 2
  - CLI vault-management: validate `devices` parameter before calling SDK
  - parseKeygenQR: throw error on unknown libType instead of silently defaulting

  **Code quality:**
  - Replace try-catch with attempt() pattern in JoinSecureVaultService and parseKeygenQR
  - Add abort signal checks in SecureVaultJoiner callbacks

  **Documentation:**
  - Add onProgress callback to joinSecureVault README documentation
  - Fix markdown heading format in SDK-USERS-GUIDE.md
  - Add language specifier to code block in CLAUDE.md

  **Tests:**
  - Fix Korean test mnemonic (removed invalid comma)
  - Add Korean language detection test
  - Remove sensitive private key logging in test helpers

- Updated dependencies [[`fee3f37`](https://github.com/vultisig/vultisig-sdk/commit/fee3f375f85011d14be814f06ff3d7f6684ea2fe), [`695e664`](https://github.com/vultisig/vultisig-sdk/commit/695e664668082ca55861cf4d8fcc8c323be94c06), [`4edf52d`](https://github.com/vultisig/vultisig-sdk/commit/4edf52d3a2985d2adf772239bf19b8301f360af8), [`d145809`](https://github.com/vultisig/vultisig-sdk/commit/d145809eb68653a3b22921fcb90ebc985de2b16a)]:
  - @vultisig/sdk@0.3.0

## 0.2.0

### Minor Changes

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add broadcastRawTx() for broadcasting pre-signed transactions

  Adds `broadcastRawTx()` method supporting all chain families:
  - EVM: Ethereum, Polygon, BSC, Arbitrum, Base, etc. (hex-encoded)
  - UTXO: Bitcoin, Litecoin, Dogecoin, etc. (hex-encoded)
  - Solana: Base58 or Base64 encoded transaction bytes
  - Cosmos: JSON `{tx_bytes}` or raw base64 protobuf (10 chains)
  - TON: BOC as base64 string
  - Polkadot: Hex-encoded extrinsic
  - Ripple: Hex-encoded transaction blob
  - Sui: JSON `{unsignedTx, signature}`
  - Tron: JSON transaction object

  CLI commands added:
  - `vultisig sign --chain <chain> --bytes <base64>` - sign pre-hashed data
  - `vultisig broadcast --chain <chain> --raw-tx <data>` - broadcast raw tx

  Documentation updated with complete workflow examples for EVM, UTXO, Solana, and Sui.

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: separate unlock and export passwords in CLI export command

  The export command now has two distinct password options:
  - `--password`: Unlocks the vault (decrypts stored keyshares for encrypted vaults)
  - `--exportPassword`: Encrypts the exported file (defaults to `--password` if not specified)

  This fixes the "Password required but callback returned empty value" error when exporting encrypted vaults.

  Password resolution now uses an in-memory cache that persists across SDK callbacks, allowing the CLI to pre-cache the unlock password before vault loading.

- [#60](https://github.com/vultisig/vultisig-sdk/pull/60) [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: Add SecureVault support for multi-device MPC vaults
  - Implement SecureVault.create() for multi-device keygen ceremony
  - Add RelaySigningService for coordinated signing via relay server
  - Implement SecureVault.sign() and signBytes() methods
  - Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
  - CLI: Add `vault create --type secure` with terminal QR display
  - CLI: Support secure vault signing with device coordination
  - Add comprehensive unit, integration, and E2E tests

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add seedphrase (BIP39 mnemonic) import functionality

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

### Patch Changes

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Optimize SDK bundling configuration
  - Add terser minification (~60% bundle size reduction)
  - Add clean script to remove stale dist files before builds
  - Centralize duplicated onwarn handler in rollup config
  - Add package.json exports for react-native and electron platforms

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Replace development command references (`npm run wallet`) with production CLI name (`vultisig`) in all user-facing messages.

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix interactive shell prompts by replacing REPL with readline to prevent stdin conflicts with inquirer

- [#58](https://github.com/vultisig/vultisig-sdk/pull/58) [`c9b7d88`](https://github.com/vultisig/vultisig-sdk/commit/c9b7d888e21e9db1b928ddc929294aa15157e476) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix password prompt being swallowed by spinner during signing
  - Add `--password` option to `send` and `swap` commands for non-interactive use
  - Pre-unlock vault before signing spinner starts to prevent prompt interference
  - Password prompt now appears before spinner when not provided via CLI flag

- [`9dcfb8b`](https://github.com/vultisig/vultisig-sdk/commit/9dcfb8b4b29de73b1301f791b50dc417a8f899f3) - fix: use yarn npm publish to properly resolve workspace protocols

- [`0985a37`](https://github.com/vultisig/vultisig-sdk/commit/0985a375c6009e2550231d759e84b576454ce759) - fix: use workspace:^ for SDK dependency to resolve correctly when publishing

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Simplify export command by removing `--encrypt` and `--no-encrypt` flags. Password is now optional - if provided, vault is encrypted; if omitted or empty, vault is exported without encryption. Path argument now supports directories (appends SDK-generated filename).

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update browser example and CLI for new fast vault creation API
  - Updated to use new `createFastVault()` that returns just the vaultId
  - Updated to use new `verifyVault()` that returns the FastVault
  - Removed `code` from CLI `CreateVaultOptions` (verification code always prompted interactively)
  - Removed `--code` option from CLI create command

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add inline verification code retry during vault creation. When entering an incorrect code, users can now retry, resend the verification email, or abort gracefully instead of being kicked back to the main menu.

- Updated dependencies [[`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`7f60cd5`](https://github.com/vultisig/vultisig-sdk/commit/7f60cd5835510bd9110d6382cf7d03bf1d5e04ff), [`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af), [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c), [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b), [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3), [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c), [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b)]:
  - @vultisig/sdk@0.2.0

## 0.2.0-beta.9

### Minor Changes

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add broadcastRawTx() for broadcasting pre-signed transactions

  Adds `broadcastRawTx()` method supporting all chain families:
  - EVM: Ethereum, Polygon, BSC, Arbitrum, Base, etc. (hex-encoded)
  - UTXO: Bitcoin, Litecoin, Dogecoin, etc. (hex-encoded)
  - Solana: Base58 or Base64 encoded transaction bytes
  - Cosmos: JSON `{tx_bytes}` or raw base64 protobuf (10 chains)
  - TON: BOC as base64 string
  - Polkadot: Hex-encoded extrinsic
  - Ripple: Hex-encoded transaction blob
  - Sui: JSON `{unsignedTx, signature}`
  - Tron: JSON transaction object

  CLI commands added:
  - `vultisig sign --chain <chain> --bytes <base64>` - sign pre-hashed data
  - `vultisig broadcast --chain <chain> --raw-tx <data>` - broadcast raw tx

  Documentation updated with complete workflow examples for EVM, UTXO, Solana, and Sui.

### Patch Changes

- Updated dependencies [[`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af), [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3)]:
  - @vultisig/sdk@0.2.0-beta.9

## 0.2.0-beta.8

### Minor Changes

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: separate unlock and export passwords in CLI export command

  The export command now has two distinct password options:
  - `--password`: Unlocks the vault (decrypts stored keyshares for encrypted vaults)
  - `--exportPassword`: Encrypts the exported file (defaults to `--password` if not specified)

  This fixes the "Password required but callback returned empty value" error when exporting encrypted vaults.

  Password resolution now uses an in-memory cache that persists across SDK callbacks, allowing the CLI to pre-cache the unlock password before vault loading.

### Patch Changes

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Simplify export command by removing `--encrypt` and `--no-encrypt` flags. Password is now optional - if provided, vault is encrypted; if omitted or empty, vault is exported without encryption. Path argument now supports directories (appends SDK-generated filename).

- Updated dependencies [[`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8)]:
  - @vultisig/sdk@0.2.0-beta.8

## 0.2.0-alpha.7

### Minor Changes

- [#60](https://github.com/vultisig/vultisig-sdk/pull/60) [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: Add SecureVault support for multi-device MPC vaults
  - Implement SecureVault.create() for multi-device keygen ceremony
  - Add RelaySigningService for coordinated signing via relay server
  - Implement SecureVault.sign() and signBytes() methods
  - Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
  - CLI: Add `vault create --type secure` with terminal QR display
  - CLI: Support secure vault signing with device coordination
  - Add comprehensive unit, integration, and E2E tests

### Patch Changes

- Updated dependencies [[`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295)]:
  - @vultisig/sdk@0.2.0-alpha.7

## 0.2.0-alpha.6

### Patch Changes

- [#58](https://github.com/vultisig/vultisig-sdk/pull/58) [`c9b7d88`](https://github.com/vultisig/vultisig-sdk/commit/c9b7d888e21e9db1b928ddc929294aa15157e476) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix password prompt being swallowed by spinner during signing
  - Add `--password` option to `send` and `swap` commands for non-interactive use
  - Pre-unlock vault before signing spinner starts to prevent prompt interference
  - Password prompt now appears before spinner when not provided via CLI flag

## 0.2.0-alpha.5

### Patch Changes

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`6137bc6`](https://github.com/vultisig/vultisig-sdk/commit/6137bc65bdf06ea5f6ede009ac72ec58b7cac7d1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Optimize SDK bundling configuration
  - Add terser minification (~60% bundle size reduction)
  - Add clean script to remove stale dist files before builds
  - Centralize duplicated onwarn handler in rollup config
  - Add package.json exports for react-native and electron platforms

- Updated dependencies [[`6137bc6`](https://github.com/vultisig/vultisig-sdk/commit/6137bc65bdf06ea5f6ede009ac72ec58b7cac7d1), [`c75f442`](https://github.com/vultisig/vultisig-sdk/commit/c75f442ce4e34521aa8d0f704c415f63c24dba8f)]:
  - @vultisig/sdk@0.2.0-alpha.5

## 0.2.0-alpha.3

### Patch Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Replace development command references (`npm run wallet`) with production CLI name (`vultisig`) in all user-facing messages.

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix interactive shell prompts by replacing REPL with readline to prevent stdin conflicts with inquirer

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update browser example and CLI for new fast vault creation API
  - Updated to use new `createFastVault()` that returns just the vaultId
  - Updated to use new `verifyVault()` that returns the FastVault
  - Removed `code` from CLI `CreateVaultOptions` (verification code always prompted interactively)
  - Removed `--code` option from CLI create command

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add inline verification code retry during vault creation. When entering an incorrect code, users can now retry, resend the verification email, or abort gracefully instead of being kicked back to the main menu.

- Updated dependencies [[`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c), [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c)]:
  - @vultisig/sdk@0.2.0-alpha.3

## 0.1.1-alpha.2

### Patch Changes

- [`9dcfb8b`](https://github.com/vultisig/vultisig-sdk/commit/9dcfb8b4b29de73b1301f791b50dc417a8f899f3) - fix: use yarn npm publish to properly resolve workspace protocols

## 0.1.1-alpha.1

### Patch Changes

- [`0985a37`](https://github.com/vultisig/vultisig-sdk/commit/0985a375c6009e2550231d759e84b576454ce759) - fix: use workspace:^ for SDK dependency to resolve correctly when publishing

## 0.1.1-alpha.0

### Patch Changes

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

- Updated dependencies [[`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179)]:
  - @vultisig/sdk@0.1.1-alpha.0

## 0.1.0

### Patch Changes

- [`1f20084`](https://github.com/vultisig/vultisig-sdk/commit/1f20084bdaf6ddf00d2dd5c70ec6070e00a94e91) - docs: update documentation to reflect current SDK and CLI interfaces
  - Fix import paths: use `@vultisig/sdk` instead of platform-specific paths (`/node`, `/browser`)
  - Update Node.js version requirement from 18+ to 20+
  - Fix Storage interface documentation (generic types, correct method signatures)
  - Fix WASM copy instruction package name (`@vultisig/sdk` not `vultisig-sdk`)
  - Add missing CLI environment variable `VULTISIG_VAULT`
  - Add missing CLI interactive shell commands (`vault`, `.clear`)
  - Add `--vault` global option to CLI documentation
  - Fix project structure paths in SDK README

- [`c862869`](https://github.com/vultisig/vultisig-sdk/commit/c8628695cfc47209b26bfe628c9608d29c541a5b) - fix: npm package installation issues
  - Remove bundled internal packages (@core/_, @lib/_) from SDK dependencies - these are bundled into dist
  - Switch CLI build from tsc to esbuild for proper ESM compatibility
  - Update publish workflow to use `yarn npm publish` with --tolerate-republish
  - Require Node.js >= 20

- Updated dependencies [[`8694cd9`](https://github.com/vultisig/vultisig-sdk/commit/8694cd957573b8334ff0f29167f8b45c5140ce42), [`1f20084`](https://github.com/vultisig/vultisig-sdk/commit/1f20084bdaf6ddf00d2dd5c70ec6070e00a94e91), [`c862869`](https://github.com/vultisig/vultisig-sdk/commit/c8628695cfc47209b26bfe628c9608d29c541a5b)]:
  - @vultisig/sdk@0.1.0
