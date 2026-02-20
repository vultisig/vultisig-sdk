# @vultisig/sdk

## 0.5.0

### Minor Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`cd57d64`](https://github.com/vultisig/vultisig-sdk/commit/cd57d6482e08bd6172550ec4eea0e0233abd7f76) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add max send/swap support across SDK, CLI, and example apps
  - Add `vault.getMaxSendAmount()` returning `{ balance, fee, maxSendable }` for fee-accurate max sends
  - Add `vault.estimateSendFee()` for gas estimation without max calculation
  - Enrich `getSwapQuote()` with `balance` and `maxSwapable` fields
  - CLI: Add `--max` flag to `send`, `swap`, and `swap-quote` commands
  - Browser/Electron examples: Add "Max" button to Send and Swap screens
  - Fix native token ticker resolution in example swap UI (was using chain name instead of ticker)

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`ea1e8d5`](https://github.com/vultisig/vultisig-sdk/commit/ea1e8d5dd14a7273021577471e44719609f983ca) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add vault reshare support, fix secure vault creation progress steps, and add balancesWithPrices method
  - Add `performReshare()` to Vultisig class and SecureVaultCreationService for vault reshare operations
  - Fix secure vault creation progress mapping so QR code and device discovery UI display correctly during the waiting-for-devices phase
  - Add `balancesWithPrices()` to VaultBase that returns balances enriched with price and fiat value data from FiatValueService

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`3f5fdcb`](https://github.com/vultisig/vultisig-sdk/commit/3f5fdcbfbe23aa287dfbcb38e9be6c904af9caf0) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SDK gap features for extension migration: token registry (getKnownTokens, getKnownToken, getFeeCoin), price feeds (getCoinPrices), security scanning (scanSite, validateTransaction, simulateTransaction), fiat on-ramp (getBanxaSupportedChains, getBuyUrl), token discovery (discoverTokens, resolveToken), and CosmosMsgType constants. All features use SDK-owned types decoupled from core internals.

### Patch Changes

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`bd543af`](https://github.com/vultisig/vultisig-sdk/commit/bd543af73a50a4ce431f38e3ed77511c4ef65ea7) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Align SDK dependency versions with upstream core packages
  - viem: 2.37.4 → ^2.45.1 (external - critical for consumers)
  - @trustwallet/wallet-core: ^4.3.22 → ^4.6.0 (external)
  - @bufbuild/protobuf: ^2.10.2 → ^2.11.0 (external)
  - @mysten/sui: ^1.37.6 → ^2.3.0 (SUI v2 migration)
  - @lifi/sdk: ^3.12.2 → ^3.15.5
  - i18next: ^25.5.2 → ^25.8.4

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`74516fa`](https://github.com/vultisig/vultisig-sdk/commit/74516fae8dabd844c9e0793b932f6284ce9aa009) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SDK-level chain validation to catch invalid enum values (e.g. "BitcoinCash" vs Chain.BitcoinCash) with descriptive error messages. Fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver. Fix SwapService crash on general swap quotes by unwrapping SwapQuote wrapper to access the inner discriminated union.

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`7ceab79`](https://github.com/vultisig/vultisig-sdk/commit/7ceab79e53986bfefa3f5d4cb5d25855572fbd3f) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Use KeysignLibType for keysign payloads to correctly handle seedphrase-imported vaults

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

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`6c5c77c`](https://github.com/vultisig/vultisig-sdk/commit/6c5c77ceb49620f711285effee98b052e6aab1f8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream core and lib from vultisig-windows
  - Solana: support multiple raw transactions in signing inputs
  - EVM: fetch token logos from 1Inch API in metadata resolver
  - Cosmos: normalize fee denominations with toChainFeeDenom helper
  - Cosmos: filter out TCY autocompounder share denom from coin discovery
  - Cosmos: add AZTEC token to Thorchain known tokens
  - Swap: add getSwapTrackingUrl utility for block explorer URLs
  - Remove unused getRecordSize utility

## 0.4.3

### Patch Changes

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Align SDK dependency versions with upstream core packages
  - viem: 2.37.4 → ^2.45.1 (external - critical for consumers)
  - @trustwallet/wallet-core: ^4.3.22 → ^4.6.0 (external)
  - @bufbuild/protobuf: ^2.10.2 → ^2.11.0 (external)
  - @mysten/sui: ^1.37.6 → ^2.3.0 (SUI v2 migration)
  - @lifi/sdk: ^3.12.2 → ^3.15.5
  - i18next: ^25.5.2 → ^25.8.4

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix opaque "is not a function" error when chain value doesn't match enum (e.g. BCH). match() now throws a descriptive error with the bad value and available handlers. Also fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver.

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream core and lib from vultisig-windows
  - Solana: support multiple raw transactions in signing inputs
  - EVM: fetch token logos from 1Inch API in metadata resolver
  - Cosmos: normalize fee denominations with toChainFeeDenom helper
  - Cosmos: filter out TCY autocompounder share denom from coin discovery
  - Cosmos: add AZTEC token to Thorchain known tokens
  - Swap: add getSwapTrackingUrl utility for block explorer URLs
  - Remove unused getRecordSize utility

## 0.4.2

### Patch Changes

- [#91](https://github.com/vultisig/vultisig-sdk/pull/91) [`57adaf8`](https://github.com/vultisig/vultisig-sdk/commit/57adaf8b391dc57956073b4b06efa3f7566a275a) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(sdk): fix SecureVault relay signing for EdDSA chains
  - Fix QR payload to include full transaction details using `getJoinKeysignUrl` from core
  - Fix chainPath derivation using `getChainSigningInfo` adapter
  - Fix EdDSA signature format: use raw r||s (128 hex chars) instead of DER encoding

  Affected chains: Solana, Sui, Polkadot, TON, Cardano

## 0.4.1

### Patch Changes

- [#89](https://github.com/vultisig/vultisig-sdk/pull/89) [`e5812b7`](https://github.com/vultisig/vultisig-sdk/commit/e5812b743a3e1c8ce27b81f8940d5c818cf66017) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix EdDSA signature verification failure for Solana and other EdDSA chains

  The signature format conversion was corrupting EdDSA signatures by round-tripping through DER encoding. EdDSA signatures now store raw r||s format directly, preserving the correct endianness from keysign.

  Affected chains: Solana, Sui, Polkadot, Ton, Cardano

- [#89](https://github.com/vultisig/vultisig-sdk/pull/89) [`f0d39d2`](https://github.com/vultisig/vultisig-sdk/commit/f0d39d2615968ea2761c1e19d64b2a54ba72a1a9) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix FastVault signing to show session ID instead of "undefined" in server acknowledgment log, and add missing `chain` parameter to signWithServer call

## 0.4.0

### Minor Changes

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

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add automatic VULT discount tier support for swap affiliate fees
  - Add `DiscountTierService` that fetches VULT token and Thorguard NFT balances on Ethereum
  - Automatically apply discount tiers (bronze through ultimate) to all swap quotes
  - Add `vault.getDiscountTier()` to check current discount tier
  - Add `vault.updateDiscountTier()` to force refresh after acquiring more VULT
  - Remove manual `affiliateBps` parameter from swap quote params (now automatic)
  - Cache discount tier for 15 minutes to minimize RPC calls

### Patch Changes

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(examples): add discount tier display to browser and electron examples
  - Add `getDiscountTier()` and `updateDiscountTier()` to ISDKAdapter interface
  - Implement discount tier methods in BrowserSDKAdapter and ElectronSDKAdapter
  - Add VULT Discount Tier card to VaultOverview with color-coded tier badge and refresh button
  - Display discount tier in swap quote details
  - Update browser README with discount tier and swap documentation

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

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream changes and use core's defaultChains
  - Import `defaultChains` from core instead of defining locally in SDK
  - Default chains now: Bitcoin, Ethereum, THORChain, Solana, BSC
  - Upstream: Added thor.ruji and thor.rune token metadata
  - Upstream: Fixed commVault serialization for empty chain keys
  - Upstream: Enhanced formatAmount with suffix support

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Use core's `vaultConfig.maxNameLength` for vault name validation instead of hardcoded value

## 0.3.0

### Minor Changes

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`695e664`](https://github.com/vultisig/vultisig-sdk/commit/695e664668082ca55861cf4d8fcc8c323be94c06) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add multi-language BIP39 mnemonic support

  **New Features:**
  - Support for all 10 BIP39 languages: English, Japanese, Korean, Spanish, Chinese (Simplified/Traditional), French, Italian, Czech, Portuguese
  - Auto-detection of mnemonic language during validation
  - Explicit language validation with `{ language: 'japanese' }` option
  - Word suggestions for autocomplete with `getSuggestions(prefix, language)`
  - Japanese ideographic space (U+3000) handling
  - Proper Unicode NFKD normalization

  **New Exports:**
  - `Bip39Language` - Union type of supported languages
  - `BIP39_LANGUAGES` - Array of supported language codes
  - `SeedphraseValidationOptions` - Options for explicit language validation
  - `detectMnemonicLanguage()` - Detect language from mnemonic
  - `getWordlist()` - Get wordlist for a specific language
  - `BIP39_WORDLISTS` - Map of all wordlists
  - `normalizeMnemonic()` - Normalize mnemonic with Unicode handling

  **API Usage:**

  ```typescript
  // Auto-detect language
  const result = await sdk.validateSeedphrase(japaneseMnemonic);
  console.log(result.detectedLanguage); // 'japanese'

  // Explicit language
  const result = await sdk.validateSeedphrase(mnemonic, { language: "korean" });
  ```

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`d145809`](https://github.com/vultisig/vultisig-sdk/commit/d145809eb68653a3b22921fcb90ebc985de2b16a) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): rename seedphrase import APIs and add joinSecureVault method

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

- [#72](https://github.com/vultisig/vultisig-sdk/pull/72) [`4edf52d`](https://github.com/vultisig/vultisig-sdk/commit/4edf52d3a2985d2adf772239bf19b8301f360af8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address review comments for type safety and test reliability

  **Type safety:**
  - JoinSecureVaultOptions: make `devices` field required (was optional but enforced at runtime)
  - parseKeygenQR: validate chains against Chain enum instead of unsafe cast

  **Test improvements:**
  - generateTestPartyId: use deterministic index-based suffix to avoid collisions
  - multi-party-keygen-helpers: fail-fast when chainCodeHex is missing instead of silent fallback
  - languageDetection tests: replace invalid Chinese mnemonics with valid BIP39 test vectors
  - Add Chinese Simplified and Traditional language detection tests

  **Documentation:**
  - README: rename "Import from Seedphrase" to "Create Vault from Seedphrase" to match API naming

## 0.2.0

### Minor Changes

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add AbortSignal support for keygen and seedphrase import operations
  - Added `signal?: AbortSignal` parameter to `createFastVault()`, `createSecureVault()`, `importSeedphraseAsFastVault()`, and `importSeedphraseAsSecureVault()`
  - Abort checks are performed at natural breakpoints: in waitForPeers loops, between ECDSA/EdDSA keygen phases, and between per-chain key imports
  - Allows users to cancel long-running vault creation operations gracefully using standard AbortController API

- [#56](https://github.com/vultisig/vultisig-sdk/pull/56) [`7f60cd5`](https://github.com/vultisig/vultisig-sdk/commit/7f60cd5835510bd9110d6382cf7d03bf1d5e04ff) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add signBytes() method for signing arbitrary pre-hashed data

  Adds a new `signBytes()` method to vaults that allows signing arbitrary byte arrays:
  - Accepts `Uint8Array`, `Buffer`, or hex string input
  - Uses chain parameter to determine signature algorithm (ECDSA/EdDSA) and derivation path
  - Available on FastVault (implemented) and SecureVault (placeholder for future)

  Example usage:

  ```typescript
  const sig = await vault.signBytes({
    data: keccak256(message),
    chain: Chain.Ethereum,
  });
  ```

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

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SignAmino and SignDirect Cosmos SDK signing methods

  This release adds support for custom Cosmos transaction signing with two new methods:
  - `vault.prepareSignAminoTx()` - Sign using the legacy Amino (JSON) format
  - `vault.prepareSignDirectTx()` - Sign using the modern Protobuf format

  These methods enable governance votes, staking operations, IBC transfers, and other custom Cosmos transactions across all supported Cosmos SDK chains (Cosmos, Osmosis, THORChain, MayaChain, Dydx, Kujira, Terra, TerraClassic, Noble, Akash).

  New exported types:
  - `SignAminoInput`, `SignDirectInput`
  - `CosmosMsgInput`, `CosmosFeeInput`, `CosmosCoinAmount`
  - `CosmosSigningOptions`

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - **BREAKING**: Change fast vault creation API to return vault from verification
  - `createFastVault()` now returns `Promise<string>` (just the vaultId)
  - `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
  - Vault is only persisted to storage after successful email verification
  - If process is killed before verification, vault is lost (user recreates)

  This is a cleaner API - the user only gets the vault after it's verified and persisted.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Remove internal-only exports from public API for GA launch

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

- [#60](https://github.com/vultisig/vultisig-sdk/pull/60) [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: Add SecureVault support for multi-device MPC vaults
  - Implement SecureVault.create() for multi-device keygen ceremony
  - Add RelaySigningService for coordinated signing via relay server
  - Implement SecureVault.sign() and signBytes() methods
  - Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
  - CLI: Add `vault create --type secure` with terminal QR display
  - CLI: Support secure vault signing with device coordination
  - Add comprehensive unit, integration, and E2E tests

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add per-chain MPC key import for feature parity with vultisig-windows

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

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix CodeRabbit review issues for beta-3 release
  - Fix `@noble/hashes` import path for v2 compatibility (sha512 → sha2)
  - Fix chainPublicKeys/chainKeyShares persistence in VaultData to prevent data loss on vault reload

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix EdDSA public key derivation and ChainDiscoveryService issues
  - Fix `deriveChainKey` to use correct public key type for EdDSA chains (Solana, Sui, Polkadot, Ton use ed25519, Cardano uses ed25519Cardano)
  - Fix timeout cleanup in ChainDiscoveryService to prevent unhandled rejections and memory leaks
  - Add guard against zero/negative concurrencyLimit to prevent infinite loop

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(node): add globalThis.crypto polyfill for WASM MPC libraries

  The WASM MPC libraries (DKLS, Schnorr) use `crypto.getRandomValues()` internally via wasm-bindgen. Node.js 18+ has webcrypto but it's not on `globalThis` by default, causing "unreachable" errors during MPC signing. This adds the polyfill before any WASM initialization.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix seedphrase import portfolio showing zero balances

  After importing a seedphrase with detected balances, portfolio was showing zero balances because chain-specific public keys from the MPC import were not being used for address derivation.

  **Root cause:** BIP44 derivation paths contain hardened levels (e.g., `m/44'/60'/0'`) which cannot be derived from a public key alone. Chain-specific public keys must be stored during import (when private keys are available) and used later for address derivation.

  **Fixes:**
  - `VaultBase.ts`: Preserve `chainPublicKeys` and `chainKeyShares` when loading vaults
  - `AddressService.ts`: Pass `chainPublicKeys` to `getPublicKey()` for correct address derivation
  - `Vultisig.ts`: Set imported chains as active chains so portfolio shows relevant chains

  **Backwards compatible:** Non-import vaults (regular fast/secure, imported shares) are unaffected as they fall back to master key derivation when `chainPublicKeys` is undefined.

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: preserve keyshares in VaultBase constructor when provided via parsedVaultData

  Previously, the VaultBase constructor always set `keyShares: { ecdsa: '', eddsa: '' }` for lazy loading, ignoring any keyshares passed in `parsedVaultData`. This caused exported vault files to be missing keyshare data (~700 bytes instead of ~157KB), making them unusable for signing or re-import.

  The fix preserves keyshares from `parsedVaultData` when available, falling back to empty strings for lazy loading only when keyshares aren't provided.

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: shared examples package and electron adapter parity
  - Created `examples/shared` package with shared components and adapters for browser and electron examples
  - Implemented adapter pattern (ISDKAdapter, IFileAdapter) for platform-agnostic code
  - Added full Electron IPC handlers for token, portfolio, and swap operations
  - Fixed BigInt serialization for Electron IPC (prepareSendTx, sign, swap operations)
  - Fixed SecureVault threshold calculation using correct 2/3 majority formula
  - Added event subscriptions in Electron app for balance, chain, transaction, and error events
  - Reduced code duplication between browser and electron examples by ~1400 lines

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update ARCHITECTURE.md and SDK-USERS-GUIDE.md to reflect current codebase state: fix version number, monorepo structure, createFastVault API example, platform bundles table, and storage layer description.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - chore: update upstream DKLS and Schnorr WASM libraries

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

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: shared examples package and electron adapter parity
  - Created `examples/shared` package with shared components and adapters for browser and electron examples
  - Implemented adapter pattern (ISDKAdapter, IFileAdapter) for platform-agnostic code
  - Added full Electron IPC handlers for token, portfolio, and swap operations
  - Fixed BigInt serialization for Electron IPC (prepareSendTx, sign, swap operations)
  - Fixed SecureVault threshold calculation using correct 2/3 majority formula
  - Added event subscriptions in Electron app for balance, chain, transaction, and error events
  - Reduced code duplication between browser and electron examples by ~1400 lines

## 0.2.0-beta.8

### Patch Changes

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: preserve keyshares in VaultBase constructor when provided via parsedVaultData

  Previously, the VaultBase constructor always set `keyShares: { ecdsa: '', eddsa: '' }` for lazy loading, ignoring any keyshares passed in `parsedVaultData`. This caused exported vault files to be missing keyshare data (~700 bytes instead of ~157KB), making them unusable for signing or re-import.

  The fix preserves keyshares from `parsedVaultData` when available, falling back to empty strings for lazy loading only when keyshares aren't provided.

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

## 0.2.0-alpha.5

### Patch Changes

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`6137bc6`](https://github.com/vultisig/vultisig-sdk/commit/6137bc65bdf06ea5f6ede009ac72ec58b7cac7d1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Optimize SDK bundling configuration
  - Add terser minification (~60% bundle size reduction)
  - Add clean script to remove stale dist files before builds
  - Centralize duplicated onwarn handler in rollup config
  - Add package.json exports for react-native and electron platforms

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`c75f442`](https://github.com/vultisig/vultisig-sdk/commit/c75f442ce4e34521aa8d0f704c415f63c24dba8f) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(node): add globalThis.crypto polyfill for WASM MPC libraries

  The WASM MPC libraries (DKLS, Schnorr) use `crypto.getRandomValues()` internally via wasm-bindgen. Node.js 18+ has webcrypto but it's not on `globalThis` by default, causing "unreachable" errors during MPC signing. This adds the polyfill before any WASM initialization.

## 0.2.0-alpha.4

### Minor Changes

- [#56](https://github.com/vultisig/vultisig-sdk/pull/56) [`7f60cd5`](https://github.com/vultisig/vultisig-sdk/commit/7f60cd5835510bd9110d6382cf7d03bf1d5e04ff) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add signBytes() method for signing arbitrary pre-hashed data

  Adds a new `signBytes()` method to vaults that allows signing arbitrary byte arrays:
  - Accepts `Uint8Array`, `Buffer`, or hex string input
  - Uses chain parameter to determine signature algorithm (ECDSA/EdDSA) and derivation path
  - Available on FastVault (implemented) and SecureVault (placeholder for future)

  Example usage:

  ```typescript
  const sig = await vault.signBytes({
    data: keccak256(message),
    chain: Chain.Ethereum,
  });
  ```

## 0.2.0-alpha.3

### Minor Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - **BREAKING**: Change fast vault creation API to return vault from verification
  - `createFastVault()` now returns `Promise<string>` (just the vaultId)
  - `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
  - Vault is only persisted to storage after successful email verification
  - If process is killed before verification, vault is lost (user recreates)

  This is a cleaner API - the user only gets the vault after it's verified and persisted.

### Patch Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update ARCHITECTURE.md and SDK-USERS-GUIDE.md to reflect current codebase state: fix version number, monorepo structure, createFastVault API example, platform bundles table, and storage layer description.

## 0.1.1-alpha.0

### Patch Changes

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

## 0.1.0

### Patch Changes

- [`8694cd9`](https://github.com/vultisig/vultisig-sdk/commit/8694cd957573b8334ff0f29167f8b45c5140ce42) - Add BrowserStorage and FileStorage to TypeScript documentation

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
