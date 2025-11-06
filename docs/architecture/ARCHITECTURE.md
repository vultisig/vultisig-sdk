# Vultisig SDK Architecture

**Last Updated:** November 2025
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [System Architecture](#system-architecture)
4. [Directory Structure](#directory-structure)
5. [Core Components](#core-components)
6. [Runtime Layer](#runtime-layer)
7. [Services Layer](#services-layer)
8. [Adapters Layer](#adapters-layer)
9. [Events System](#events-system)
10. [Type System](#type-system)
11. [Design Patterns](#design-patterns)
12. [Data Flow](#data-flow)
13. [Chain Support](#chain-support)
14. [Development Guide](#development-guide)

---

## Overview

The Vultisig SDK is a TypeScript library for creating and managing multi-chain cryptocurrency vaults using threshold signature schemes (TSS). It provides a unified interface for interacting with 34+ blockchain networks through multi-party computation (MPC), working seamlessly across browser, Node.js, Electron, and Chrome extension environments.

### What It Does

- **Vault Management** - Create, import, and manage cryptocurrency vaults
- **Multi-Chain Support** - Unified API for Bitcoin, Ethereum, Solana, and 30+ other chains
- **MPC Signing** - Secure transaction signing using threshold signatures
- **Balance Tracking** - Query native and token balances across all chains
- **Address Derivation** - Generate addresses for any supported chain
- **Gas Estimation** - Get current gas prices and fee estimates
- **Cross-Platform** - Works in browser, Node.js, Electron, Chrome extensions

### Architecture Overview

The SDK follows a clean 3-layer architecture:

1. **Public API Layer** - User-facing interfaces (`Vultisig`, `index.ts`)
2. **Core Management Layer** - Business logic (`VaultManager`, `ChainManager`, `AddressBookManager`)
3. **Infrastructure Layer** - Runtime support (`storage`, `events`, `adapters`, `services`)

**Design Philosophy:** The SDK is a thin layer over the Vultisig Core library, using functional adapters to convert between Core's data formats and user-friendly SDK types. All blockchain logic lives in Core - the SDK focuses on providing excellent developer experience.

---

## Architecture Principles

### 1. Functional Adapter Pattern

The SDK uses functional adapters to convert between Core's data formats and user-friendly SDK types, with minimal abstraction layers.

```typescript
// Vault calls Core functions directly
class Vault {
  async balance(chain: string): Promise<Balance> {
    // 1. Call Core directly
    const rawBalance = await getCoinBalance({ chain, address })

    // 2. Format with adapter
    return formatBalance(rawBalance, chain)
  }
}
```

**Key characteristics:**
- Direct Core integration (no wrapper services)
- Adapters are pure formatting functions
- All blockchain logic delegated to Core
- SDK focuses on caching, events, and coordination

### 2. Environment Agnostic

The SDK works seamlessly across all JavaScript environments through runtime detection and appropriate storage/utility selection:

- Browser (IndexedDB storage)
- Node.js (filesystem storage)
- Electron (main/renderer process aware)
- Chrome Extensions (chrome.storage API)
- Web Workers (memory storage fallback)

### 3. Type-Safe Events

All events are type-safe through generics, ensuring compile-time safety for event names and payloads:

```typescript
interface VaultEvents {
  balanceUpdated: { chain: string; balance: Balance }
  transactionSigned: { chain: string; txHash: string }
}

vault.on('balanceUpdated', ({ chain, balance }) => {
  // TypeScript knows the exact payload shape
})
```

### 4. Smart Caching Strategy

Intelligent caching based on data mutability:
- **Addresses:** Permanent cache (deterministic, never change)
- **Balances:** 5-minute TTL (change frequently)
- **Gas prices:** No cache (highly volatile)

---

## System Architecture

### Component Diagram

```
┌──────────────────────────────────────┐
│        User Application              │
│    (React, Vue, Node.js, etc.)      │
└─────────────────┬────────────────────┘
                  │
             ┌────▼────┐
             │Vultisig │ ← Main SDK class (facade pattern)
             └────┬────┘
      ┌───────────┼────────────┬──────────────┐
      │           │            │              │
 ┌────▼────┐ ┌───▼────┐ ┌────▼────┐ ┌───────▼───────┐
 │  Vault  │ │ Chain  │ │Address  │ │Storage        │
 │ Manager │ │Manager │ │Book Mgr │ │Manager        │
 └────┬────┘ └────────┘ └─────────┘ └───────┬───────┘
      │                                      │
 ┌────▼──────────────────────────────┐     │
 │         Vault Instance            │     │
 │  ┌──────────────────────────────┐│     │
 │  │• Address derivation          ││     │
 │  │• Balance fetching            ││     │
 │  │• Gas estimation              ││     │
 │  │• Transaction signing         ││     │
 │  │• Token/Chain management      ││     │
 │  └──────────────────────────────┘│     │
 └────┬──────────────┬───────────────┘     │
      │              │                      │
 ┌────▼─────┐   ┌───▼──────┐              │
 │ Adapters │   │ Services │              │
 │ (format) │   │ (cache,  │              │
 │          │   │  signing) │              │
 └────┬─────┘   └───┬──────┘              │
      │             │                       │
 ┌────▼─────────────▼────────────┐   ┌────▼─────┐
 │    Vultisig Core Library      │   │ Runtime  │
 │ • deriveAddress()             │   │ Storage  │
 │ • getCoinBalance()            │   │ • Browser│
 │ • getFeeQuote()               │   │ • Node   │
 │ • buildKeysignPayload()       │   │ • Chrome │
 │ • 34+ chain resolvers         │   │ • Memory │
 └────────────────────────────────┘   └──────────┘
```

### Layer Responsibilities

| Layer | Components | Purpose |
|-------|------------|---------|
| **Public API** | `Vultisig`, `index.ts` | User-facing interfaces, SDK initialization |
| **Management** | `VaultManager`, `ChainManager`, `AddressBookManager` | Business logic, state management |
| **Vault** | `Vault` class | Per-vault operations, Core function calls |
| **Infrastructure** | Runtime, Services, Adapters, Events | Platform abstraction, data conversion |

---

## Directory Structure

```
packages/sdk/src/
├── index.ts                    # Public API exports
├── Vultisig.ts                 # Main SDK class
├── VaultManager.ts             # Vault lifecycle management
├── ChainManager.ts             # Chain configuration
├── AddressBookManager.ts       # Global address book
│
├── vault/                      # Vault functionality
│   ├── Vault.ts               # Main vault class (functional adapters)
│   ├── VaultServices.ts       # Service injection interface
│   └── index.ts               # Vault exports
│
├── runtime/                   # Runtime environment handling
│   ├── environment.ts         # Environment detection
│   ├── storage/              # Storage implementations
│   │   ├── StorageManager.ts # Storage factory
│   │   ├── BrowserStorage.ts # IndexedDB for browser
│   │   ├── NodeStorage.ts    # Filesystem for Node.js
│   │   ├── ChromeStorage.ts  # chrome.storage API
│   │   ├── MemoryStorage.ts  # In-memory fallback
│   │   └── types.ts          # Storage interfaces
│   └── utils/                # Platform-specific utilities
│       ├── browser.ts        # Browser utilities
│       ├── node.ts           # Node.js utilities
│       ├── electron.ts       # Electron utilities
│       └── chrome.ts         # Chrome extension utilities
│
├── events/                   # Event system
│   ├── EventEmitter.ts       # UniversalEventEmitter class
│   └── types.ts             # Event type definitions
│
├── services/                # Essential services
│   ├── CacheService.ts      # TTL-based caching
│   ├── FastSigningService.ts # Server-assisted MPC signing
│   └── index.ts
│
├── adapters/                # Data format conversion
│   ├── formatBalance.ts     # bigint → Balance
│   ├── formatGasInfo.ts     # FeeQuote → GasInfo
│   ├── buildKeysignPayload.ts # Transaction → Message hashes
│   └── index.ts
│
├── utils/                   # General utilities
│   ├── validation.ts        # Input validation
│   └── export.ts           # Vault export/import
│
└── types/                  # Type definitions
    └── index.ts           # SDK types and Core re-exports
```

---

## Core Components

### 1. Vultisig Class

**File:** `src/Vultisig.ts`

The main SDK class that orchestrates all functionality using the facade pattern.

```typescript
const vultisig = new Vultisig({
  defaultChains: ['Bitcoin', 'Ethereum'],
  defaultCurrency: 'USD'
})

await vultisig.connect()
```

**Responsibilities:**
- SDK initialization and lifecycle management
- Connection state management (connect/disconnect)
- Vault creation and management delegation
- Storage integration and persistence
- Event emission for SDK-level state changes
- Global configuration (default chains, currency)
- Address book operations
- Transaction signing convenience methods

**Key Dependencies:**
- `ServerManager` - Server communication
- `WASMManager` - WASM module loading
- `VaultManager` - Vault operations
- `AddressBookManager` - Address book
- `StorageManager` - Data persistence
- `UniversalEventEmitter` - Event system

### 2. VaultManager Class

**File:** `src/VaultManager.ts`

Manages vault lifecycle and vault collection using the factory pattern.

```typescript
// Create fast vault
const vault = await vaultManager.createFastVault(name, password)

// Import vault
const vault = await vaultManager.addVault(vultFile, password)

// Export vault
const encrypted = await vaultManager.exportVault(vaultId, password)
```

**Responsibilities:**
- Vault creation (fast and secure vaults)
- Vault import from .vult files (with encryption support)
- Vault export with password protection
- Active vault tracking
- Vault validation and normalization
- Service injection for Vault instances

**Key Features:**
- Automatic vault type detection (fast vs secure based on signer names)
- Encryption status caching to avoid repeated decoding
- Threshold calculation based on signer count
- Global settings application to imported vaults

### 3. Vault Class

**File:** `src/vault/Vault.ts`

Individual vault instance using functional adapter pattern for all operations.

```typescript
// Address derivation
const address = await vault.address('Ethereum')

// Balance fetching
const balance = await vault.balance('Ethereum')
const tokenBalance = await vault.balance('Ethereum', tokenContractAddress)

// Gas estimation
const gas = await vault.gas('Ethereum')

// Transaction signing
const signature = await vault.sign('fast', payload, password)
```

**Architecture Approach:**
- **Functional Adapter Pattern** - Thin layer over core functions
- Directly calls core functions (`deriveAddress`, `getCoinBalance`, `getFeeQuote`)
- Uses adapters for format conversion (bigint → Balance, FeeQuote → GasInfo)
- Minimal business logic, delegates to core

**Caching Strategy:**
- Addresses: Permanent cache (never expire)
- Balances: 5-minute TTL
- CacheService handles all caching logic

**Event Emission:**
- Extends `UniversalEventEmitter`
- Emits events for: balance updates, transactions signed, chain/token changes, rename operations

### 4. ChainManager

**File:** `src/ChainManager.ts`

Chain configuration and validation utilities.

```typescript
// Validate chain
ChainManager.validateChain('Ethereum')

// Get default chains
const chains = ChainManager.getDefaultChains()

// Convert string to Chain enum
const chainEnum = ChainManager.getChainEnum('Bitcoin')
```

**Responsibilities:**
- Chain validation against supported chains
- String to Chain enum conversion
- Default chains configuration
- Supported chains listing

**Key Features:**
- Exports `DEFAULT_CHAINS` constant
- Provides validation functions with detailed error messages
- Stateless utility functions

### 5. AddressBookManager

**File:** `src/AddressBookManager.ts`

Global address book management.

```typescript
// Add entry
addressBook.addEntry({
  chain: 'Ethereum',
  address: '0x...',
  label: 'My Wallet'
})

// Get entries for chain
const entries = addressBook.getEntriesForChain('Ethereum')
```

**Responsibilities:**
- Maintain two address books: saved and vault-derived
- Add/remove/update address entries
- Chain-specific filtering

---

## Runtime Layer

### Environment Detection

**File:** `src/runtime/environment.ts`

Detects and manages different JavaScript runtime environments.

**Supported Environments:**
- `browser` - Standard browser
- `node` - Node.js
- `electron-main` - Electron main process
- `electron-renderer` - Electron renderer process
- `chrome-extension` - Chrome extension pages
- `chrome-extension-sw` - Chrome extension service worker
- `worker` - Web Worker / Service Worker

**Detection Order (critical for correctness):**
1. Electron (checks `process.versions.electron`)
2. Chrome Extension (checks `chrome.runtime` API)
3. Web Worker / Service Worker
4. Browser (checks `window` and `document`)
5. Node.js (checks `process.versions.node`)

### Storage System

**Location:** `src/runtime/storage/`

Platform-specific storage implementations with a unified interface.

**Storage Interface:**
```typescript
interface VaultStorage {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  list(): Promise<string[]>
  clear(): Promise<void>
  getUsage?(): Promise<number>
  getQuota?(): Promise<number | undefined>
}
```

**Storage Implementations:**

| Environment | Implementation | Storage Type |
|------------|---------------|--------------|
| Browser/Electron Renderer | `BrowserStorage` | IndexedDB |
| Node.js | `NodeStorage` | Filesystem (~/.vultisig) |
| Chrome Extension | `ChromeStorage` | chrome.storage.local |
| Web Worker | `MemoryStorage` | In-memory (non-persistent) |

**StorageManager:**
- Factory for creating appropriate storage based on environment
- Auto-detection with fallback logic
- Handles Electron userData directory configuration
- Provides storage info for debugging

### Runtime Utilities

**Location:** `src/runtime/utils/`

Environment-specific utility functions.

**Browser Utilities** (`browser.ts`):
- Vault download functionality
- Storage info retrieval
- Persistent storage requests

**Node.js Utilities** (`node.ts`):
- File export/import
- Storage path management
- Directory creation

**Electron Utilities** (`electron.ts`):
- IPC communication setup
- File operations
- Process type detection

**Chrome Extension Utilities** (`chrome.ts`):
- Message handlers
- Service worker keep-alive
- Storage change listeners

---

## Services Layer

### CacheService

**File:** `src/services/CacheService.ts`

Centralized caching logic with TTL support.

```typescript
class CacheService {
  get<T>(key: string, ttl: number): T | null
  set<T>(key: string, value: T): void
  delete(key: string): void
  clear(): void
  getOrCompute<T>(key: string, ttl: number, compute: () => T): T
}
```

**Features:**
- TTL-based expiration
- Timestamp tracking
- Batch operations (clear expired)
- `getOrCompute()` pattern for lazy evaluation

**Usage:**
- Addresses: Permanent cache (`ttl = Infinity`)
- Balances: 5-minute TTL (`ttl = 5 * 60 * 1000`)

### FastSigningService

**File:** `src/services/FastSigningService.ts`

Server-assisted signing for 2-of-2 fast vaults.

```typescript
async signWithServer(
  vault: Vault,
  payload: SigningPayload,
  password: string
): Promise<Signature>
```

**Signing Flow:**
1. Validate vault has server signer
2. Get WalletCore instance
3. Build keysign payload (use pre-computed hashes or build from transaction)
4. Coordinate with ServerManager for MPC signing
5. Return formatted signature

---

## Adapters Layer

**Location:** `src/adapters/`

Pure functions that bridge between Core's functional API and SDK's structured types.

### formatBalance.ts

Converts Core's `bigint` to SDK's `Balance` object.

```typescript
export function formatBalance(
  rawBalance: bigint,
  chain: string,
  tokenId?: string,
  tokens?: Record<string, Token[]>
): Balance {
  // Token: lookup metadata from registry
  // Native: use chain metadata
  return {
    amount: rawBalance.toString(),
    symbol,
    decimals,
    chainId: chain,
    tokenId
  }
}
```

### formatGasInfo.ts

Converts Core's `FeeQuote` to SDK's `GasInfo` object.

```typescript
export function formatGasInfo(
  feeQuote: any,
  chain: string
): GasInfo {
  // EVM: complex structure (EIP-1559)
  // Others: simple gas price
  return {
    chainId: chain,
    gasPrice: feeQuote.gasPrice?.toString(),
    maxFeePerGas: feeQuote.maxFeePerGas?.toString(),
    priorityFee: feeQuote.priorityFee?.toString()
  }
}
```

### buildKeysignPayload.ts

Builds keysign payload for MPC signing.

```typescript
export async function buildKeysignPayload(
  payload: SigningPayload,
  chain: Chain,
  walletCore: WalletCore,
  vault: Vault
): Promise<string[]> {
  // Use core functions:
  // - getPublicKey()
  // - getEncodedSigningInputs()
  // - getPreSigningHashes()
  return messageHashes
}
```

---

## Events System

### UniversalEventEmitter

**File:** `src/events/EventEmitter.ts`

Zero-dependency, type-safe event emitter.

```typescript
class UniversalEventEmitter<T extends Record<string, any>> {
  on<K extends keyof T>(event: K, listener: (data: T[K]) => void): () => void
  once<K extends keyof T>(event: K, listener: (data: T[K]) => void): () => void
  protected emit<K extends keyof T>(event: K, data: T[K]): void
  off<K extends keyof T>(event: K, listener: (data: T[K]) => void): void
}
```

**Features:**
- Type-safe event names and payloads via generics
- Memory leak detection (warns at 10 listeners)
- Error isolation (handler errors don't break emission)
- `once()` listener support
- Unsubscribe function returns

### Event Types

**File:** `src/events/types.ts`

**SdkEvents:**
```typescript
interface SdkEvents {
  connect: void
  disconnect: void
  chainChanged: { chain: string }
  vaultChanged: { vaultId: string }
  error: { error: Error }
}
```

**VaultEvents:**
```typescript
interface VaultEvents {
  balanceUpdated: { chain: string; balance: Balance }
  transactionSigned: { chain: string; txHash: string }
  chainAdded: { chain: string }
  chainRemoved: { chain: string }
  tokenAdded: { chain: string; token: Token }
  tokenRemoved: { chain: string; tokenId: string }
  renamed: { oldName: string; newName: string }
  error: { error: Error }
}
```

---

## Type System

**Location:** `src/types/index.ts`

### Core Type Re-exports

Types imported from `@vultisig/core`:
- `ChainKind` - Chain categories (EVM, UTXO, Cosmos, etc.)
- `AccountCoin` - Coin with account information
- `Coin` - Basic coin structure
- `PublicKeys` - Vault public keys
- `Vault` - Core vault type (extended with threshold)

### SDK-Specific Types

```typescript
// Balance information
interface Balance {
  amount: string
  decimals: number
  symbol: string
  chainId: string
  tokenId?: string
  usdValue?: number
}

// Gas pricing information
interface GasInfo {
  chainId: string
  gasPrice: string
  gasPriceGwei?: string
  maxFeePerGas?: string
  priorityFee?: string
  lastUpdated: number
}

// Signature data
interface Signature {
  signature: string
  txHash?: string
  format: 'DER' | 'ECDSA' | 'EdDSA'
}

// Transaction payload
interface SigningPayload {
  chain: string
  transaction: {
    to: string
    value: string
    data?: string
    memo?: string
    gasLimit?: string
  }
}

// Token metadata
interface Token {
  id: string
  symbol: string
  name: string
  decimals: number
  chainId: string
  contractAddress?: string
}
```

### Configuration Types

```typescript
interface VultisigConfig {
  defaultChains?: string[]
  defaultCurrency?: string
  serverEndpoints?: {
    fastVault?: string
    relay?: string
  }
  wasmPaths?: {
    walletCore?: string
    dkls?: string
    schnorr?: string
  }
  storage?: StorageOptions
}
```

---

## Design Patterns

### 1. Facade Pattern (Vultisig)

The `Vultisig` class provides a simplified interface over complex subsystems.

```typescript
// Complex operations hidden behind simple API
const vault = await vultisig.createVault('My Vault')
// Internally coordinates: VaultManager, WASMManager, ServerManager, Storage
```

### 2. Factory Pattern (VaultManager)

Creates and configures `Vault` instances with consistent service injection.

```typescript
// Factory creates properly configured instances
const vault = vaultManager.createVault(name, {
  services: { wasmManager, fastSigningService }
})
```

### 3. Functional Adapter Pattern (Vault)

Vault is a thin wrapper that calls Core functions directly and uses adapters for formatting.

```typescript
// Direct core call + adapter formatting
async balance(chain: string): Promise<Balance> {
  const raw = await getCoinBalance({ chain, address })
  return formatBalance(raw, chain)
}
```

### 4. Strategy Pattern (Storage)

Storage implementation selected based on environment.

```typescript
// Different strategies for different environments
const storage = environment === 'browser'
  ? new BrowserStorage()
  : environment === 'node'
  ? new NodeStorage()
  : new MemoryStorage()
```

### 5. Observer Pattern (Events)

Components emit events for state changes using type-safe emitters.

```typescript
// Type-safe event emission
vault.on('balanceUpdated', ({ chain, balance }) => {
  // React to balance changes
})
```

### 6. Dependency Injection (VaultServices)

Services injected into Vault instances for flexibility and testability.

```typescript
interface VaultServices {
  wasmManager: WASMManager
  fastSigningService?: FastSigningService
}
```

---

## Data Flow

### Address Derivation Flow

```
vault.address('Ethereum')
  │
  ├─→ Check cache ────→ [HIT] Return cached
  │
  ├─→ [MISS] Get WalletCore
  │
  ├─→ Core: getPublicKey({ chain, hexChainCode, publicKeys })
  │     Output: PublicKey
  │
  ├─→ Core: deriveAddress({ chain, publicKey, walletCore })
  │     Output: address (string)
  │
  ├─→ Cache address (permanent)
  │
  └─→ Return address
```

### Balance Fetching Flow

```
vault.balance('Ethereum', tokenId?)
  │
  ├─→ Check cache (5-min) ────→ [HIT] Return cached
  │
  ├─→ [MISS] Get address via vault.address()
  │
  ├─→ Core: getCoinBalance({ chain, address, contractAddress })
  │     Output: rawBalance (bigint)
  │
  ├─→ Adapter: formatBalance(rawBalance, chain, tokenId)
  │     Output: Balance { amount, symbol, decimals }
  │
  ├─→ Cache balance (5-min TTL)
  │
  ├─→ Emit 'balanceUpdated' event
  │
  └─→ Return Balance
```

### Fast Signing Flow

```
vault.sign('fast', payload, password)
  │
  ├─→ Validate vault type (must have Server-* signer)
  │
  ├─→ Get WalletCore
  │
  ├─→ Adapter: buildKeysignPayload()
  │     ├─→ Core: buildSendKeysignPayload()
  │     ├─→ Core: getEncodedSigningInputs()
  │     └─→ Core: getPreSigningHashes()
  │     Output: messageHashes
  │
  ├─→ FastSigningService.signWithServer()
  │     ├─→ POST /fast-sign/start
  │     ├─→ WebSocket MPC coordination
  │     ├─→ Core: combineSignatures()
  │     └─→ POST /fast-sign/complete
  │
  ├─→ Emit 'transactionSigned' event
  │
  └─→ Return Signature { signature, txHash }
```

---

## Chain Support

### Supported Chains (34+)

All chains supported through Core's functional resolvers. The SDK has no chain-specific code.

| Category | Chains | Count |
|----------|--------|-------|
| **EVM** | Ethereum, Polygon, Arbitrum, Optimism, BSC, Avalanche, Base, Blast, Zksync, Mantle, Cronos | 11 |
| **UTXO** | Bitcoin, Litecoin, Dogecoin, BitcoinCash, Dash, Zcash | 6 |
| **Cosmos** | Cosmos, THORChain, MayaChain, Osmosis, Dydx, Kujira, Terra, TerraClassic, Noble, Akash | 10 |
| **Other** | Solana, Sui, Polkadot, Ton, Ripple, Tron, Cardano | 7 |

### Default Chains

When creating a new vault without specifying chains:
1. Bitcoin
2. Ethereum
3. Solana
4. THORChain
5. Ripple

### Token Support

| Chain Type | Token Standard | Example |
|------------|----------------|---------|
| EVM | ERC-20 | USDC, USDT, DAI |
| Solana | SPL | USDC (SPL), RAY |
| Cosmos | Wasm, IBC | ATOM, OSMO |

---

## Development Guide

### Adding a New Feature

1. **Check Core Support**
   ```bash
   # Browse Core for functionality
   ls packages/core/src/
   ```

2. **Add Types** (if needed)
   ```typescript
   // src/types/NewFeature.ts
   export interface NewFeature {
     // ...
   }
   ```

3. **Create Adapter** (if needed)
   ```typescript
   // src/adapters/formatNewFeature.ts
   export function formatNewFeature(coreData: any): NewFeature {
     // Pure formatting, no logic
   }
   ```

4. **Add to Vault**
   ```typescript
   async newFeature(): Promise<NewFeature> {
     // Call Core
     const result = await coreFunction()
     // Format
     return formatNewFeature(result)
   }
   ```

5. **Add Caching** (if appropriate)
   ```typescript
   const cached = this.cacheService.get(key, ttl)
   if (cached) return cached
   // ... fetch and cache
   ```

6. **Write Tests**
   ```typescript
   describe('newFeature', () => {
     it('should work for all chains', async () => {
       // Test implementation
     })
   })
   ```

### Common Patterns

#### Caching Strategy
```typescript
// Permanent (addresses)
this.cacheService.get(key, Infinity)

// TTL (balances)
this.cacheService.get(key, 5 * 60 * 1000)

// No cache (volatile data)
// Direct Core call
```

#### Error Handling
```typescript
try {
  const result = await coreFunction()
  return formatResult(result)
} catch (error) {
  this.emit('error', { error })
  throw new VaultError(
    VaultErrorCode.OperationFailed,
    `Failed to ${operation}`,
    error as Error
  )
}
```

#### Parallel Operations
```typescript
// ✅ Good: Parallel
const results = await Promise.all(
  chains.map(chain => vault.address(chain))
)

// ❌ Bad: Sequential
for (const chain of chains) {
  await vault.address(chain)
}
```

### Performance Considerations

**Caching Strategy:**
- Addresses: Never expire (immutable)
- Balances: 5-minute TTL (changes frequently)
- Gas: Not cached (highly volatile)

**WASM Loading:**
- WalletCore: Loaded on first use (~500ms)
- DKLS/Schnorr: Loaded on signing (~800ms)
- Subsequent calls instant (memoized)

**Storage Performance:**
- IndexedDB (browser): Async, good for large data
- Filesystem (Node): Fast, synchronous available
- Chrome Storage: Limited quota, async only
- Memory: Fastest but non-persistent

### Debugging Tips

**Enable Logging:**
```typescript
// Set DEBUG environment variable
DEBUG=vultisig:* npm start
```

**Check Storage:**
```typescript
const storage = vultisig.storage
const keys = await storage.list()
console.log('Stored keys:', keys)
```

**Monitor Events:**
```typescript
vault.on('balanceUpdated', console.log)
vault.on('error', console.error)
```

**Test Core Directly:**
```typescript
import { getCoinBalance } from '@vultisig/core'

const balance = await getCoinBalance({
  chain: Chain.Ethereum,
  address: '0x...'
})
```

---

## Summary

The Vultisig SDK architecture is **clean, layered, and environment-agnostic**:

- **Entry Point:** `Vultisig` class provides facade over all functionality
- **Management:** `VaultManager`, `ChainManager`, `AddressBookManager` handle business logic
- **Vault:** Functional adapter pattern calling Core directly
- **Infrastructure:** Runtime (environment + storage), Services (caching + signing), Adapters (formatting), Events (type-safe)
- **Type System:** Comprehensive types extending Core with SDK-specific structures

**Key Strengths:**
- Works seamlessly across browser, Node.js, Electron, Chrome extensions
- Clean separation of concerns with 3-layer architecture
- Type-safe throughout with TypeScript generics
- Minimal abstraction (functional approach)
- Reactive programming via events
- Smart caching based on data mutability
- Direct Core integration for blockchain operations

**Architecture Decisions:**
1. **Functional Core Calls** - Vault directly calls Core functions
2. **Minimal Services** - Only CacheService and FastSigningService
3. **Adapter Pattern** - Format conversion isolated to pure functions
4. **Permanent Address Caching** - Addresses cached forever
5. **5-Minute Balance TTL** - Balance freshness vs API efficiency
6. **Type-Safe Events** - Compile-time safety for events
7. **Environment Detection Order** - Prevents false positives
8. **Storage Abstraction** - Single interface, multiple implementations
9. **Service Injection** - Flexibility and testability

---

**Last Updated:** November 2025
**Status:** Production Ready