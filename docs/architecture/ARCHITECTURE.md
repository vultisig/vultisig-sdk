# Vultisig SDK Architecture

**Last Updated:** 2025-10-30
**Version:** 2.0

---

## Overview

The Vultisig SDK is a TypeScript SDK for secure multi-party computation (MPC) and blockchain operations. It provides vault management, multi-chain support, and server-assisted signing through a well-organized, modular architecture using strategy and service patterns.

---

## Directory Structure

```
packages/sdk/src/
├── VultisigSDK.ts           # Main SDK entry point
├── index.ts                 # Public API exports
├── types/                   # Core type definitions
├── chains/                  # Chain-specific implementations
│   ├── config/              # Chain configuration
│   │   └── ChainConfig.ts   # Centralized chain metadata registry
│   ├── strategies/          # Strategy pattern for chains
│   │   ├── ChainStrategy.ts
│   │   └── ChainStrategyFactory.ts
│   ├── evm/                 # EVM-compatible chains
│   ├── solana/              # Solana blockchain
│   └── utxo/                # Bitcoin-like chains
├── vault/                   # Vault management
│   ├── Vault.ts             # Core vault class
│   ├── services/            # Service layer
│   └── balance/             # Balance fetching
├── server/                  # Server communication
│   └── ServerManager.ts     # VultiServer coordination
├── mpc/                     # MPC operations
├── wasm/                    # WebAssembly management
└── crypto/                  # Cryptographic utilities
```

---

## Core Architecture

### Layered Architecture

```
┌─────────────────────────────────────┐
│      PUBLIC API                     │
│  - Vultisig (SDK entry point)       │
│  - Vault (vault operations)         │
│  - Types & utilities                │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      SERVICE LAYER                  │
│  - AddressService                   │
│  - BalanceService                   │
│  - SigningService                   │
│  - FastSigningService               │
│  - CacheService                     │
└──────────┬──────────────┬───────────┘
           │              │
┌──────────▼──────────┐   │
│  STRATEGY PATTERN   │   │
│  - ChainStrategy    │   │
│  - EvmStrategy      │   │
│  - SolanaStrategy   │   │
│  - UtxoStrategy     │   │
└─────────────────────┘   │
                          │
         ┌────────────────▼───────────┐
         │   SERVER OPERATIONS        │
         │   - ServerManager          │
         │   - Fast vault creation    │
         │   - Fast signing           │
         └────────────────────────────┘
```

---

## Core Classes

### Vultisig (Main SDK Class)

**Location:** [VultisigSDK.ts](../../packages/sdk/src/VultisigSDK.ts)

**Responsibilities:**
- SDK initialization and lifecycle management
- Vault creation and management (CRUD operations)
- Global configuration (default chains, currency)
- Server status checking
- Address book management (global, across all vaults)

**Key Methods:**
- `initialize()` - Initialize SDK and load WASM modules
- `createVault(name, options)` - Create new vault (fast or secure)
- `createFastVault(options)` - Create 2-of-2 vault with server
- `getVault(vaultId, password)` - Retrieve vault from VultiServer
- `addVault(file, password)` - Import vault from file
- `setActiveVault(vault)` - Set current working vault
- `signTransaction(payload, password)` - Sign with active vault

**Dependencies:**
- `ServerManager` - Server communication
- `WASMManager` - WebAssembly initialization
- `AddressBookManager` - Address book operations
- `ChainConfig` - Chain metadata and configuration
- `ChainManagement` - Chain configuration helpers
- `VaultManagement` - Vault lifecycle

---

### Vault (Core Vault Class)

**Location:** [Vault.ts](../../packages/sdk/src/vault/Vault.ts)

**Responsibilities:**
- Individual vault operations
- Address derivation per vault
- Balance fetching and caching (5-minute TTL)
- Transaction signing (fast/relay/local modes)
- Chain management per vault

**Key Features:**
- **Service-Oriented Architecture:** Uses dedicated services for different concerns
- **Caching Strategy:**
  - Permanent address caching (addresses don't change)
  - 5-minute TTL for balance caching
- **Chain Management:** Each vault can have its own active chains
- **Multi-Mode Signing:** Supports fast (server-assisted), relay (multi-device), and local signing

**Key Methods:**
- `address(chain)` - Get address for specific chain (cached)
- `addresses(chains?)` - Get addresses for multiple chains
- `balance(chain, tokenId?)` - Get balance with caching
- `balances(chains?)` - Batch balance fetching
- `updateBalance(chain)` - Force refresh balance
- `sign(mode, payload, password)` - Sign transaction with specified mode
- `setChains(chains)` - Configure active chains for vault
- `export(password?)` - Export vault to file

**Services Used:**
- `AddressService` - Address derivation via strategies
- `BalanceService` - Balance fetching with Blockchair integration
- `SigningService` - Transaction parsing and validation
- `CacheService` - TTL-based caching
- `FastSigningService` - Server-assisted signing coordination

---

### ChainConfig (Centralized Configuration)

**Location:** [ChainConfig.ts](../../packages/sdk/src/chains/config/ChainConfig.ts)

**Responsibilities:**
- Single source of truth for all chain metadata
- Chain identification and normalization
- Chain type categorization (EVM, UTXO, Cosmos, Other)
- Chain validation and querying

**Key Features:**
- **Comprehensive Registry:** 35+ supported chains with complete metadata
- **Alias Resolution:** Case-insensitive lookup with multiple aliases per chain (e.g., 'eth', 'ethereum', 'Ethereum')
- **Type System:** Categorizes chains into 'evm', 'utxo', 'cosmos', or 'other' types
- **Validation Helpers:** Methods to validate chain lists and check support

**Metadata Structure:**
Each chain includes:
- Official ID (e.g., 'Ethereum')
- Chain enum value from @core/chain/Chain
- Native token decimals
- Native token symbol
- Chain type (evm/utxo/cosmos/other)
- Aliases for flexible identification

**Key Methods:**
- `getMetadata(chainId)` - Get full chain metadata
- `getChainEnum(chainId)` - Map to Chain enum (replaces AddressDeriver.mapStringToChain)
- `getDecimals(chainId)` - Get native token decimals
- `getSymbol(chainId)` - Get native token symbol
- `getType(chainId)` - Get chain type
- `getSupportedChains()` - List all supported chains
- `getEvmChains()` / `getUtxoChains()` / `getCosmosChains()` - Get chains by type
- `isSupported(chainId)` - Check if chain is supported
- `validateChains(chainIds)` - Validate list of chain identifiers

**Registered Chain Types:**
- **EVM (11 chains - IMPLEMENTED):** Ethereum, Arbitrum, Base, Blast, Optimism, zkSync, Polygon, BSC, Avalanche, Mantle, Cronos
- **UTXO (6 chains - IMPLEMENTED):** Bitcoin, Litecoin, Bitcoin Cash, Dogecoin, Dash, Zcash
- **Other - Solana (1 chain - IMPLEMENTED):** Solana
- **Cosmos (10 chains - METADATA ONLY):** THORChain, MayaChain, Cosmos, Osmosis, Dydx, Kujira, Terra, TerraClassic, Noble, Akash
- **Other (6 chains - METADATA ONLY):** Sui, Polkadot, Ton, Ripple, Tron, Cardano

**Note:** Chains marked as "METADATA ONLY" have configuration registered in ChainConfig but do not yet have full strategy implementations. Only EVM, UTXO, and Solana chains are currently fully supported.

---

### ServerManager

**Location:** [ServerManager.ts](../../packages/sdk/src/server/ServerManager.ts)

**Responsibilities:**
- All server communications (VultiServer and MessageRelay)
- Fast vault creation (2-of-2 MPC with server)
- Fast signing coordination (server-assisted signing)
- Vault retrieval and verification
- MPC session management

**Key Operations:**

**Fast Vault Creation:**
1. Generate session parameters (sessionId, encryption keys)
2. Call `setupVaultWithServer` API
3. Join relay session
4. Wait for server to join
5. Start MPC session
6. Run ECDSA keygen (DKLS)
7. Run EdDSA keygen (Schnorr)
8. Return vault with server as co-signer

**Fast Signing Coordination:**
1. Validate vault has server signer
2. Call FastVault API with messages and session info
3. Join relay session
4. Register server as participant
5. Wait for server to join
6. Start MPC session
7. Perform MPC keysign for each message
8. Format result via strategy

**Key Methods:**
- `createFastVault(options)` - Create 2-of-2 vault with server
- `verifyVault(vaultId, code)` - Verify email code
- `getVaultFromServer(vaultId, password)` - Retrieve encrypted vault
- `coordinateFastSigning(options)` - Coordinate server-assisted signing
- `checkServerStatus()` - Check connectivity

**Configuration:**
- FastVault server: `https://api.vultisig.com/vault`
- MessageRelay server: `https://api.vultisig.com/router`

---

## Chain Support Architecture

### Strategy Pattern

The SDK uses the **Strategy Pattern** to handle different blockchain types, providing a unified interface while allowing chain-specific implementations.

**Interface:** `ChainStrategy`

```typescript
interface ChainStrategy {
  chainId: string
  deriveAddress(vault): Promise<string>
  getBalance(address): Promise<Balance>
  parseTransaction(rawTx): Promise<ParsedTransaction>
  buildKeysignPayload(tx, vaultPublicKey, options?): Promise<KeysignPayload>
  estimateGas?(tx): Promise<GasEstimate>
  computePreSigningHashes(payload, vault, walletCore): Promise<string[]>
  formatSignatureResult(signatureResults, payload): Promise<Signature>
}
```

### Chain Implementations

#### EVM Strategy

**Location:** [EvmStrategy.ts](../../packages/sdk/src/chains/evm/EvmStrategy.ts)

**Supported Chains:** All EVM-compatible chains from ChainConfig (11 total)
- Ethereum, Arbitrum, Base, Blast, Optimism, zkSync
- Polygon, BSC, Avalanche, Mantle, Cronos

**Key Features:**
- EIP-1559 transaction support (gas pricing)
- Single-message signing (one hash per transaction)
- RLP encoding/decoding
- Transaction parsing for transfers, swaps (Uniswap, 1inch), approvals
- Gas estimation with EIP-1559 fees
- ECDSA signature format with recovery ID

**Chain-Specific Logic:**
- Uses `viem` for transaction serialization and keccak256 hashing
- Supports ERC-20 token operations
- Common DEX integrations (Uniswap, 1inch)

#### Solana Strategy

**Location:** [SolanaStrategy.ts](../../packages/sdk/src/chains/solana/SolanaStrategy.ts)

**Key Features:**
- Ed25519 signatures (not ECDSA)
- Transaction parsing for Jupiter and Raydium swaps
- Base64/Buffer transaction format
- Ed25519 signature format

**Signature Algorithm:** Ed25519 (EdDSA)

#### UTXO Strategy

**Location:** [UtxoStrategy.ts](../../packages/sdk/src/chains/utxo/UtxoStrategy.ts)

**Supported Chains:** All UTXO-based chains from ChainConfig (6 total)
- Bitcoin (SegWit - wpkh)
- Litecoin (SegWit - wpkh)
- Bitcoin Cash, Dogecoin, Dash, Zcash (Legacy - pkh)

**Key Features:**
- **Multi-message signing:** UTXO transactions can have multiple inputs, each requiring a separate signature
- PSBT (Partially Signed Bitcoin Transaction) format
- Transaction compilation after signing
- Blockchair integration for fast balance fetching
- Multiple script types (SegWit, Legacy)

**Signing Process:**
1. Validate PSBT is present
2. Create KeysignPayload with UTXOSpecific
3. Extract transaction input data
4. Compute pre-signing hash for each input
5. Sign each input with MPC
6. Compile fully signed transaction

---

**Note on Cosmos Chains:**
ChainConfig includes metadata for 10 Cosmos-based chains (THORChain, MayaChain, Cosmos, Osmosis, Dydx, Kujira, Terra, TerraClassic, Noble, Akash), but CosmosStrategy implementation is not yet complete. These chains are registered in the configuration system for future support.

---

### ChainStrategyFactory

**Location:** [ChainStrategyFactory.ts](../../packages/sdk/src/chains/strategies/ChainStrategyFactory.ts)

**Responsibilities:**
- Register and lookup chain strategies
- Create default factory with all supported chains
- Validate chain support
- Data-driven strategy registration via ChainConfig

**Factory Initialization:**
```typescript
function createDefaultStrategyFactory() {
  const factory = new ChainStrategyFactory()

  // Register EVM chains dynamically from ChainConfig
  const evmChains = ChainConfig.getEvmChains()
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))

  // Register UTXO chains dynamically from ChainConfig
  const utxoChains = ChainConfig.getUtxoChains()
  factory.registerUtxoChains(utxoChains, (chainId) => new UtxoStrategy(chainId))

  // Register Solana
  factory.register('Solana', new SolanaStrategy())

  return factory
}
```

**Key Benefits:**
- **No Hardcoded Lists:** Chain lists come from ChainConfig registry
- **Single Source of Truth:** Adding a chain to ChainConfig makes it available to the factory
- **Easy Maintenance:** No need to update multiple files when adding chains

---

## Service Layer

The Vault class delegates to specialized services for separation of concerns:

### AddressService

**Location:** [AddressService.ts](../../packages/sdk/src/vault/services/AddressService.ts)

**Responsibilities:**
- Coordinate address derivation
- Delegate to chain strategies
- Batch address derivation

### BalanceService

**Location:** [BalanceService.ts](../../packages/sdk/src/vault/services/BalanceService.ts)

**Responsibilities:**
- Coordinate balance fetching
- Blockchair integration with RPC fallback
- Type conversion (bigint to Balance)
- Batch balance operations
- Chain metadata integration via ChainConfig

**Key Features:**
- **Blockchair First:** Tries Blockchair API for 5-10x faster responses
- **Automatic Fallback:** Falls back to strategy RPC calls on failure
- **Parallel Fetching:** Fetches multiple balances concurrently
- **ChainConfig Integration:** Uses `ChainConfig.getDecimals()` and `ChainConfig.getSymbol()` for chain-specific formatting

### SigningService

**Location:** [SigningService.ts](../../packages/sdk/src/vault/services/SigningService.ts)

**Responsibilities:**
- Transaction parsing via strategies
- Keysign payload building
- Gas estimation coordination
- Payload validation

### CacheService

**Location:** [CacheService.ts](../../packages/sdk/src/vault/services/CacheService.ts)

**Responsibilities:**
- TTL-based caching
- Cache invalidation
- Get-or-compute pattern

**Key Features:**
- Generic type support
- Automatic expiration (5-minute TTL for balances)
- Cache clearing (single key or all)

### FastSigningService

**Location:** [FastSigningService.ts](../../packages/sdk/src/vault/services/FastSigningService.ts)

**Responsibilities:**
- Coordinate fast signing flow
- Bridge between strategies and ServerManager
- Validate fast vault requirements

**Fast Signing Flow:**
1. Validate vault has server signer
2. Get chain strategy
3. Initialize WalletCore
4. Compute pre-signing hashes via strategy
5. Coordinate signing with ServerManager
6. Format result via strategy

---

## Design Patterns

### Strategy Pattern
**Used For:** Chain-specific operations

**Benefits:**
- Unified interface across chains
- Easy to add new chains
- Chain logic encapsulation

### Service Pattern
**Used For:** Vault operations

**Benefits:**
- Separation of concerns
- Testability
- Reusability

### Facade Pattern
**Used For:** SDK entry point

**Benefits:**
- Simplified API
- Hide complexity
- Consistent interface

### Factory Pattern
**Used For:** Strategy creation

**Benefits:**
- Centralized registration
- Dynamic strategy lookup
- Configuration management

---

## Vault Types

### Fast Vault (2-of-2 with Server)
- One device + VultiServer as co-signers
- Fast signing without device coordination
- Email verification required
- Server signer name starts with "Server-"

### Secure Vault (N-of-M Multi-Device)
- Multiple devices as signers
- No server involvement
- Requires device coordination via relay or local P2P
- More secure, slower signing

---

## Key Features

### Blockchair Integration
- **Purpose:** 5-10x faster balance fetching
- **Supported:** UTXO chains (Bitcoin, Litecoin, etc.)
- **Fallback:** Automatic RPC fallback on failure

### Caching Strategy
**Addresses:**
- Permanent caching (addresses never change)
- Stored in `Vault.addressCache`

**Balances:**
- 5-minute TTL caching
- Managed by `CacheService`
- Force refresh available

### Multi-Message Signing (UTXO)
- UTXO transactions can have multiple inputs
- Each input requires a separate signature
- Strategy computes hash per input
- ServerManager signs each hash
- Strategy compiles final transaction

### Type Safety
- Strong TypeScript typing throughout
- Chain-specific types (ParsedEvmTransaction, ParsedSolanaTransaction)
- Balance, Signature, KeysignPayload interfaces
- Type exports for public API consumers

---

## Public API Surface

**Exported from [index.ts](../../packages/sdk/src/index.ts):**

**Core Classes:**
- `Vultisig` - Main SDK
- `Vault` - Vault operations
- `VaultError` - Error handling

**Utilities:**
- `ValidationHelpers` - Input validation
- `createVaultBackup`, `getExportFileName` - Export utilities

**Types:** ~50+ TypeScript types exported for developer use

**Internal (Not Exported):**
- ServerManager, ChainConfig - Implementation details
- Strategies, Services - Encapsulated
- Chain parsers, builders - Internal utilities

---

## Security Considerations

### MPC Security
- Threshold cryptography (2-of-2 or N-of-M)
- Key shares never combined
- Server never has full key
- Encrypted communication

### Password Protection
- Vault encryption with password
- Server-side vault encryption (fast vaults)
- No plaintext key storage

### Session Management
- Unique session IDs per operation
- Encryption keys per session
- Party ID verification
- Relay server coordination

---

## Summary

The Vultisig SDK is built on a **service-oriented, strategy-based architecture** that provides:

1. **Clean Separation:** SDK → Vault → Services → Strategies
2. **Chain Abstraction:** Unified interface with chain-specific implementations
3. **Performance:** Blockchair integration, caching, parallel operations
4. **Flexibility:** Multiple vault types, signing modes, chain support
5. **Maintainability:** Clear patterns, strong typing, testable services
6. **Security:** MPC, encryption, threshold signatures

The architecture supports easy extension for new chains (implement `ChainStrategy`) and new features (add services) while maintaining a clean public API.
