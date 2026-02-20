# @vultisig/cli

## 0.5.0

### Minor Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`cd57d64`](https://github.com/vultisig/vultisig-sdk/commit/cd57d6482e08bd6172550ec4eea0e0233abd7f76) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add max send/swap support across SDK, CLI, and example apps
  - Add `vault.getMaxSendAmount()` returning `{ balance, fee, maxSendable }` for fee-accurate max sends
  - Add `vault.estimateSendFee()` for gas estimation without max calculation
  - Enrich `getSwapQuote()` with `balance` and `maxSwapable` fields
  - CLI: Add `--max` flag to `send`, `swap`, and `swap-quote` commands
  - Browser/Electron examples: Add "Max" button to Send and Swap screens
  - Fix native token ticker resolution in example swap UI (was using chain name instead of ticker)

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`75f441c`](https://github.com/vultisig/vultisig-sdk/commit/75f441cdf711e6ba04eed412dcf34002c5705144) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add Rujira DEX integration with FIN order book swaps, secured asset deposits/withdrawals, and CLI commands. New package: @vultisig/rujira for THORChain DEX operations (includes asset registry).

### Patch Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`e172aff`](https://github.com/vultisig/vultisig-sdk/commit/e172aff35aff86d182646a521dc1e3ac9e381f60) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address PR review bugs and safety issues
  - Fix missing ChromeExtensionPolyfills import causing build failure
  - Fix floating-point precision loss in CLI amount parsing for high-decimal tokens
  - Fix BigInt crash on non-integer amount strings in swap validation
  - Fix Number exponentiation precision loss in VaultSend formatAmount
  - Use VaultError with error codes in chain validation instead of generic Error
  - Add chainId mismatch validation in signAndBroadcast
  - Add hex string input validation in hexDecode
  - Guard against empty accounts array in client getAddress
  - Use stricter bech32 THORChain address validator in deposit module

- Updated dependencies [[`bd543af`](https://github.com/vultisig/vultisig-sdk/commit/bd543af73a50a4ce431f38e3ed77511c4ef65ea7), [`74516fa`](https://github.com/vultisig/vultisig-sdk/commit/74516fae8dabd844c9e0793b932f6284ce9aa009), [`7ceab79`](https://github.com/vultisig/vultisig-sdk/commit/7ceab79e53986bfefa3f5d4cb5d25855572fbd3f), [`cd57d64`](https://github.com/vultisig/vultisig-sdk/commit/cd57d6482e08bd6172550ec4eea0e0233abd7f76), [`e172aff`](https://github.com/vultisig/vultisig-sdk/commit/e172aff35aff86d182646a521dc1e3ac9e381f60), [`75f441c`](https://github.com/vultisig/vultisig-sdk/commit/75f441cdf711e6ba04eed412dcf34002c5705144), [`ea1e8d5`](https://github.com/vultisig/vultisig-sdk/commit/ea1e8d5dd14a7273021577471e44719609f983ca), [`3f5fdcb`](https://github.com/vultisig/vultisig-sdk/commit/3f5fdcbfbe23aa287dfbcb38e9be6c904af9caf0), [`6c5c77c`](https://github.com/vultisig/vultisig-sdk/commit/6c5c77ceb49620f711285effee98b052e6aab1f8)]:
  - @vultisig/sdk@0.5.0
  - @vultisig/rujira@1.0.0

## 0.4.0

### Minor Changes

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add `vultisig delete` command to remove vaults from local storage without manually deleting files from `~/.vultisig/`. Supports deletion by vault name, ID, or ID prefix, with confirmation prompt (skippable via `--yes` flag).

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add discount command to view VULT discount tier for swap fees
  - New `discount` command shows current tier, fee rate, and next tier requirements
  - Support `--refresh` flag to force cache invalidation
  - Swap quotes now display discount tier when affiliate fees are applied
  - Updated README with discount tier documentation

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add `--add-all` flag to chains command to add all supported chains at once

  New vaults start with only 5 default chains, but the SDK supports 36 chains. Users previously had to run `chains --add <chain>` 31 times to enable all chains. Now they can simply run:

  ```bash
  vultisig chains --add-all
  ```

  This works in both CLI mode and interactive shell mode.

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: add Phantom wallet Solana derivation path support

  When importing a seedphrase, the SDK now detects if the mnemonic was originally created in Phantom wallet by checking both the standard Solana BIP44 path and Phantom's non-standard path (`m/44'/501'/0'/0'`).

  **SDK changes:**
  - `discoverChainsFromSeedphrase()` now returns `ChainDiscoveryAggregate` with `results` and `usePhantomSolanaPath` flag
  - Added `usePhantomSolanaPath` option to `createFastVaultFromSeedphrase()`, `createSecureVaultFromSeedphrase()`, and `joinSecureVault()`
  - Auto-detection during chain discovery: uses Phantom path when it has balance and standard path doesn't

  **CLI changes:**
  - Added `--use-phantom-solana-path` flag to `create-from-seedphrase fast` and `create-from-seedphrase secure` commands

  **Examples:**
  - Added Phantom Solana path toggle checkbox in SeedphraseImporter component

### Patch Changes

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix balance display to show human-readable amounts instead of raw values (wei/satoshis). Add `--raw` flag for programmatic use.

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address code review items across SDK and CLI

  **CLI improvements:**
  - Fix Phantom path detection message to use effective flag value
  - Add ambiguous vault detection in delete command with descriptive error messages
  - Refactor `findVaultByIdOrName` to use object parameter and throw on ambiguous matches
  - Import tier config from SDK instead of hardcoding values in discount command

  **SDK improvements:**
  - Export VULT discount tier configuration for CLI consumption
  - Add error handling in SwapService using attempt/withFallback pattern

  **Documentation fixes:**
  - Add `text` language identifier to code fence in CLI README
  - Remove redundant "originally" word from Phantom wallet descriptions
  - Update "affiliate fee discounts" to "swap fee discounts" terminology

- Updated dependencies [[`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160), [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160), [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160), [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160), [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160), [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160)]:
  - @vultisig/sdk@0.4.0

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
