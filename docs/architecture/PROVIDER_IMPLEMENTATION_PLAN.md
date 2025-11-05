# Unified Provider Implementation Plan

**Version:** 1.0
**Date:** 2025-01-04
**Status:** Ready for Implementation
**Estimated Timeline:** 5 weeks
**Estimated LOC:** ~1800 new lines (90% code reuse)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Rationale & Approach](#rationale--approach)
3. [Analysis of Existing Codebase](#analysis-of-existing-codebase)
4. [Architecture Overview](#architecture-overview)
5. [Implementation Phases](#implementation-phases)
6. [File Structure](#file-structure)
7. [Dependencies](#dependencies)
8. [Testing Strategy](#testing-strategy)
9. [Documentation Requirements](#documentation-requirements)
10. [Success Criteria](#success-criteria)
11. [Timeline & Milestones](#timeline--milestones)

---

## Executive Summary

This plan outlines the implementation of a **framework-agnostic unified provider layer** for the Vultisig SDK. The provider will enable both browser and Node.js applications (including Electron apps) to interact with Vultisig vaults through a consistent, programmatic API similar to Web3 providers.

### Key Design Principles

1. **Maximum Code Reuse (90%)** - Leverage existing SDK, Core, and Lib infrastructure
2. **Framework Agnostic** - Works with vanilla JS, Node.js, React, Vue, Svelte, etc.
3. **Environment Aware** - Auto-detects and adapts to browser, Node.js, and Electron
4. **Event Driven** - Real-time updates without polling
5. **Type Safe** - Full TypeScript support
6. **Backward Compatible** - Existing SDK usage remains unaffected

### What We're Building

A **thin reactive state layer** (~1800 LOC) that wraps the existing battle-tested SDK infrastructure:

- ✅ Storage abstraction (IndexedDB, localStorage, filesystem)
- ✅ Event-driven state management
- ✅ Auto-environment detection
- ✅ Electron-specific optimizations
- ✅ Zero framework dependencies

### What We're NOT Building

- ❌ Chain-specific logic (already exists in Core)
- ❌ MPC protocols (already exists in Core)
- ❌ Vault encryption (already exists in Lib)
- ❌ WASM management (already exists in SDK)
- ❌ Framework-specific integrations (can be added later as optional packages)

---

## Rationale & Approach

### Why This Approach?

Our comprehensive analysis of the Vultisig SDK codebase revealed that **90% of the required functionality already exists**. The original unified provider implementation document proposed building many components from scratch, which would have resulted in:

- ❌ Duplication of existing, battle-tested code
- ❌ 5000+ lines of new code to maintain
- ❌ 16+ weeks of development time
- ❌ High risk of introducing bugs
- ❌ Maintenance burden of parallel implementations

### Our Refined Approach

Instead, we designed a **thin provider layer** that:

- ✅ Wraps existing SDK infrastructure with minimal new code
- ✅ Delegates all operations to proven implementations
- ✅ Adds only what's genuinely missing (storage persistence, events, auto-detection)
- ✅ Reduces implementation from 16 weeks to 5 weeks
- ✅ Reduces new code from 5000+ LOC to ~1800 LOC
- ✅ Minimizes risk through maximum reuse

### Framework-Agnostic Rationale

The original documentation specifies support for "React, Vue, Node.js apps" - **not** a specific framework. We initially considered Svelte 5 runes but corrected course to build a framework-agnostic provider because:

1. **Universal Compatibility** - Works in any JavaScript environment
2. **No Lock-In** - Users can choose their preferred framework
3. **Smaller Bundle** - No framework dependency overhead
4. **Simpler Maintenance** - One codebase for all environments
5. **Future Proof** - Framework-specific wrappers can be added later as optional packages

### Electron Support Rationale

Electron apps are a critical use case for desktop wallet applications. Our provider automatically:

- Detects Electron main vs renderer processes
- Uses appropriate storage (filesystem in main, IndexedDB in renderer)
- Provides IPC helper methods for secure communication
- Auto-selects Electron userData directory for vault storage

---

## Analysis of Existing Codebase

### Core Package (`@core/*`) - Functional Dispatch Pattern

**Key Finding:** Core implements a sophisticated functional dispatch pattern where chain-specific operations are handled by resolvers. The provider should **call these functions directly** rather than reimplementing logic.

**Reusable Components:**

| Component | Location | Provider Usage |
|-----------|----------|----------------|
| Address Derivation | `@core/chain/publicKey/address/deriveAddress` | ✅ Direct call |
| Balance Fetching | `@core/chain/coin/balance/getCoinBalance` | ✅ Via Vault.balance() |
| Transaction Broadcast | `@core/chain/tx/broadcast/broadcastTx` | ✅ Direct call |
| Fee Estimation | `@core/chain/feeQuote/getFeeQuote` | ✅ Via Vault.gas() |
| Encryption | `@lib/utils/encryption/aesGcm/*` | ✅ For storage encryption |
| MPC Protocols | `@core/mpc/keysign/`, `@core/mpc/keygen/` | ✅ Via ServerManager |
| Swap Integrations | `@core/chain/swap/*` | ✅ Direct integration |

**Chain Support:** 40+ chains (EVM, UTXO, Cosmos, Solana, etc.) with 10 resolver families.

**Critical Insight:** All chain-specific logic exists in Core. Provider must NOT reimplement any of it.

### Lib Package (`@lib/*`) - Utility Functions

**Key Finding:** Lib contains 100+ battle-tested utility functions that should be reused.

**Reusable Utilities:**

- **Array Operations:** `groupItems`, `splitBy`, `without`, `withoutDuplicates`, etc.
- **Object/Record:** `pick`, `omit`, `recordMap`, `withoutUndefinedFields`, etc.
- **Async/Promise:** `asyncFallbackChain`, `chainPromises`, `ignorePromiseOutcome`
- **Error Handling:** `extractErrorMsg`, `transformError`, `attempt`
- **Network:** `queryUrl` (type-safe HTTP client)
- **Validation:** `validateEmail`, custom validators
- **Crypto:** Random bytes, base64 encoding/decoding

**Critical Insight:** Do NOT reimplement utility functions. Import from `@lib/utils`.

### SDK Package (`@sdk/*`) - Manager Architecture

**Key Finding:** SDK already implements robust manager classes that handle all vault operations.

**Manager Classes (100% Reusable):**

#### VaultManager (`@sdk/VaultManager`)
- ✅ Vault CRUD (create, import, delete, list)
- ✅ File I/O (.vult files)
- ✅ Encryption/decryption integration
- ✅ Active vault management
- ✅ Fast vault creation (2-of-2 with VultiServer)

**Provider Integration:** Use VaultManager directly, add storage persistence layer.

#### ServerManager (`@sdk/server/ServerManager`)
- ✅ FastVault server communication
- ✅ Message relay coordination
- ✅ Fast signing orchestration
- ✅ Server health checks

**Provider Integration:** Use ServerManager as-is via SDK instance.

#### WASMManager (`@sdk/wasm/WASMManager`)
- ✅ Lazy WASM module loading (memoized)
- ✅ WalletCore initialization
- ✅ DKLS WASM initialization (ECDSA)
- ✅ Schnorr WASM initialization (EdDSA)

**Provider Integration:** Use WASMManager as-is, never call WASM directly.

#### Vault Class (`@sdk/vault/Vault`)

**Architecture:** Thin adapter over Core functions with intelligent caching:
- **Addresses:** Permanent cache (never change)
- **Balances:** 5-minute TTL cache
- **Gas:** No cache (always fresh)

**Key Methods:**
```typescript
// All delegate to Core functions
vault.address(chain)              // → deriveAddress() + cache
vault.balance(chain, tokenId?)    // → getCoinBalance() + 5-min cache
vault.gas(chain)                  // → getFeeQuote() (no cache)
vault.sign(mode, payload)         // → FastSigningService → MPC
```

**Provider Integration:** Use Vault class directly. Its caching strategy is already optimal.

### What's Actually Missing (Must Build)

Based on analysis, these components genuinely don't exist and must be built:

1. **Storage Persistence** - VaultManager uses in-memory Map (lost on reload)
2. **Event System** - No event emitter for state changes
3. **Environment Detection** - No auto-detection of browser/Node.js/Electron
4. **Provider Interface** - No unified API abstraction
5. **Auto-initialization** - No single entry point with smart defaults

**Total new code needed:** ~1800 lines (vs 5000+ if reimplementing existing)

---

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Application Layer                               │
│    (Vanilla JS, React, Vue, Svelte, Node.js, Electron)      │
└────────────────────────┬────────────────────────────────────┘
                         │ uses
┌────────────────────────▼────────────────────────────────────┐
│           Unified Provider Layer (NEW - 1800 LOC)           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  VultisigProvider Interface                          │   │
│  │  - BrowserProvider   - NodeProvider                  │   │
│  │  - ElectronProvider  - Factory                       │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Storage Abstraction                                 │   │
│  │  - BrowserStorage (IndexedDB/localStorage)           │   │
│  │  - NodeStorage (filesystem, Electron-aware)          │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Event System (UniversalEventEmitter)                │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ delegates to
┌────────────────────────▼────────────────────────────────────┐
│           Existing SDK Layer (REUSE - 0 changes)            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  VaultManager → Vault CRUD, Import/Export            │   │
│  │  ServerManager → FastVault, Fast Signing             │   │
│  │  WASMManager → WASM Initialization                   │   │
│  │  Vault → Address, Balance, Gas, Signing              │   │
│  │  CacheService → TTL-based caching                    │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ uses
┌────────────────────────▼────────────────────────────────────┐
│              Core Layer (REUSE - 0 changes)                 │
│  - Chain operations (40+ chains)                            │
│  - MPC protocols (DKLS, Schnorr)                            │
│  - Swap integrations (THORChain, 1inch, LiFi)               │
│  - Encryption (AES-GCM)                                     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Example: Get Balance

```
User Code
  ↓ provider.getBalance({ chain: 'Ethereum' })
Provider Layer (NEW)
  ↓ Check connected, emit event
  ↓ this.activeVault.balance('Ethereum')
SDK Vault Class (REUSE)
  ↓ Check cache (5-min TTL)
  ↓ If miss: getCoinBalance({ chain, ... })
Core Layer (REUSE)
  ↓ Resolve chain type (EVM)
  ↓ Call EVM balance resolver
  ↓ HTTP request to RPC endpoint
  ↓ Return bigint amount
SDK Vault Class
  ↓ Format: bigint → Balance object
  ↓ Cache result (5-min TTL)
Provider Layer
  ↓ Emit 'balanceUpdated' event
  ↓ Return Balance to user
User Code
  ↓ Update UI
```

**Key Point:** Provider is a thin orchestration layer. All heavy lifting done by existing code.

---

## Implementation Phases

### PHASE 1: Storage Persistence Layer (Week 1)

#### 1.1 Storage Interface
**NEW FILE:** `packages/sdk/src/provider/storage/types.ts` (~50 lines)

```typescript
/**
 * Universal storage interface for vault persistence.
 * Implementations must support async operations.
 */
export interface VaultStorage {
  /**
   * Retrieve a value by key.
   * @returns The value if found, null otherwise
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Store a value with a key.
   * @throws If storage quota exceeded or storage unavailable
   */
  set<T>(key: string, value: T): Promise<void>

  /**
   * Remove a value by key.
   */
  remove(key: string): Promise<void>

  /**
   * List all stored keys.
   */
  list(): Promise<string[]>

  /**
   * Clear all stored data.
   * @throws If operation not permitted
   */
  clear(): Promise<void>
}
```

**Rationale:** Simple key-value interface that all storage implementations can fulfill. No complex transactions or query features needed.

#### 1.2 Browser Storage (IndexedDB + localStorage)
**NEW FILE:** `packages/sdk/src/provider/storage/BrowserStorage.ts` (~150 lines)

**Features:**
- Primary: IndexedDB (largest quota, ~50MB+)
- Fallback 1: localStorage (~5-10MB)
- Fallback 2: In-memory Map (private browsing)
- Automatic fallback chain on quota exceeded
- Optional encryption at rest using existing AES-GCM utilities

**Key Implementation Points:**
```typescript
import { encryptWithAesGcm, decryptWithAesGcm } from '@lib/utils/encryption/aesGcm'

export class BrowserStorage implements VaultStorage {
  private db?: IDBDatabase
  private mode: 'indexeddb' | 'localstorage' | 'memory'

  async initialize() {
    try {
      this.db = await this.openIndexedDB()
      this.mode = 'indexeddb'
    } catch {
      try {
        localStorage.setItem('test', 'test')
        localStorage.removeItem('test')
        this.mode = 'localstorage'
      } catch {
        this.mode = 'memory'
      }
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    // REUSE: Encrypt using existing AES-GCM utilities
    const encrypted = await encryptWithAesGcm(JSON.stringify(value), password)

    if (this.mode === 'indexeddb') {
      // Store in IndexedDB
    } else if (this.mode === 'localstorage') {
      // Store in localStorage
    } else {
      // Store in memory Map
    }
  }

  // ... other methods
}
```

**REUSES:**
- ✅ `@lib/utils/encryption/aesGcm` for encryption
- ✅ `idb` library (optional) for IndexedDB helpers

#### 1.3 Node.js Storage (Filesystem)
**NEW FILE:** `packages/sdk/src/provider/storage/NodeStorage.ts` (~120 lines)

**Features:**
- Filesystem-based storage
- **Electron-aware:** Auto-detects `app.getPath('userData')`
- Atomic writes using temp files + rename
- JSON serialization with optional encryption
- Default path: `~/.vultisig/` or Electron userData

**Key Implementation Points:**
```typescript
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export class NodeStorage implements VaultStorage {
  private basePath: string

  constructor(config?: { basePath?: string }) {
    this.basePath = config?.basePath ?? this.getDefaultPath()
  }

  private getDefaultPath(): string {
    // ELECTRON DETECTION
    if (typeof process !== 'undefined' && process.versions?.electron) {
      try {
        const { app } = require('electron')
        return join(app.getPath('userData'), '.vultisig')
      } catch {
        // In renderer without access to app, use home dir
      }
    }

    // Default to home directory
    return join(homedir(), '.vultisig')
  }

  async set<T>(key: string, value: T): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true })

    const filePath = join(this.basePath, `${key}.json`)
    const tempPath = `${filePath}.tmp`

    // Atomic write: write to temp, then rename
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2))
    await fs.rename(tempPath, filePath)
  }

  // ... other methods
}
```

**REUSES:**
- ✅ Node.js `fs/promises` APIs
- ✅ Electron `app.getPath('userData')` when available

#### 1.4 Memory Storage (Testing)
**NEW FILE:** `packages/sdk/src/provider/storage/MemoryStorage.ts` (~40 lines)

**Features:**
- Simple in-memory Map
- For testing and temporary vaults
- No persistence (lost on reload)

```typescript
export class MemoryStorage implements VaultStorage {
  private store = new Map<string, any>()

  async get<T>(key: string): Promise<T | null> {
    return this.store.get(key) ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async clear(): Promise<void> {
    this.store.clear()
  }
}
```

---

### PHASE 2: Event System (Week 1)

#### 2.1 Universal Event Emitter
**NEW FILE:** `packages/sdk/src/provider/events/EventEmitter.ts` (~80 lines)

**Rationale:** Need a type-safe event emitter that works in all environments (browser, Node.js, Electron) without external dependencies.

```typescript
/**
 * Type-safe event emitter that works in all JavaScript environments.
 * No external dependencies required.
 */
export class UniversalEventEmitter<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<Function>>()
  private maxListeners = 10 // Memory leak protection

  /**
   * Register an event listener.
   */
  on<K extends keyof Events>(
    event: K,
    handler: (data: Events[K]) => void
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }

    const handlers = this.listeners.get(event)!
    handlers.add(handler)

    // Warn if too many listeners (possible memory leak)
    if (handlers.size > this.maxListeners) {
      console.warn(
        `Possible memory leak: ${handlers.size} listeners for event "${String(event)}"`
      )
    }
  }

  /**
   * Register a one-time event listener.
   */
  once<K extends keyof Events>(
    event: K,
    handler: (data: Events[K]) => void
  ): void {
    const onceWrapper = (data: Events[K]) => {
      handler(data)
      this.off(event, onceWrapper)
    }
    this.on(event, onceWrapper)
  }

  /**
   * Unregister an event listener.
   */
  off<K extends keyof Events>(
    event: K,
    handler: (data: Events[K]) => void
  ): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * Emit an event to all listeners.
   * Protected - only callable from subclasses.
   */
  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data)
        } catch (error) {
          console.error(`Error in event handler for "${String(event)}":`, error)
        }
      }
    }
  }

  /**
   * Remove all listeners for an event.
   */
  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }
}
```

**REUSES:**
- ✅ Nothing - this is one of the few genuinely new utilities needed
- ❌ NOT using `eventemitter3` or other libraries (zero dependencies)

#### 2.2 Provider Events
**NEW FILE:** `packages/sdk/src/provider/events/types.ts` (~30 lines)

```typescript
import type { Balance } from '@vultisig/sdk'

/**
 * Events emitted by the provider for state changes.
 * Consumers can listen to these for reactive updates.
 */
export interface ProviderEvents {
  /** Emitted when provider successfully connects */
  'connect': void

  /** Emitted when provider disconnects */
  'disconnect': void

  /** Emitted when active accounts change for a chain */
  'accountsChanged': {
    chain: string
    accounts: string[]
  }

  /** Emitted when active chain changes */
  'chainChanged': {
    chain: string
  }

  /** Emitted when active vault changes */
  'vaultChanged': {
    vaultId: string
  }

  /** Emitted when a balance is fetched or updated */
  'balanceUpdated': {
    chain: string
    balance: Balance
  }

  /** Emitted on errors */
  'error': Error
}
```

---

### PHASE 3: Environment Detection (Week 1)

#### 3.1 Environment Utilities
**NEW FILE:** `packages/sdk/src/provider/environment.ts` (~60 lines)

**Rationale:** Need robust environment detection to select the correct provider and storage implementation.

```typescript
/**
 * Detected runtime environment types.
 */
export type Environment =
  | 'browser'           // Standard browser
  | 'node'              // Node.js
  | 'electron-main'     // Electron main process
  | 'electron-renderer' // Electron renderer process
  | 'unknown'           // Unsupported

/**
 * Detect the current runtime environment.
 * Order matters: Check Electron first, then browser, then Node.js.
 */
export function detectEnvironment(): Environment {
  // Check for Electron (must be first - has both process and window)
  if (typeof process !== 'undefined' && process.versions?.electron) {
    // Main process has type 'browser', renderer has type 'renderer'
    if (process.type === 'browser') return 'electron-main'
    if (process.type === 'renderer') return 'electron-renderer'
  }

  // Check for browser (has window and document)
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser'
  }

  // Check for Node.js (has process and Node version)
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node'
  }

  return 'unknown'
}

/**
 * Check if running in a browser environment.
 * Includes Electron renderer (has browser APIs).
 */
export function isBrowser(): boolean {
  const env = detectEnvironment()
  return env === 'browser' || env === 'electron-renderer'
}

/**
 * Check if running in a Node.js environment.
 * Includes Electron main process (has Node.js APIs).
 */
export function isNode(): boolean {
  const env = detectEnvironment()
  return env === 'node' || env === 'electron-main'
}

/**
 * Check if running in Electron (any process).
 */
export function isElectron(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.electron
}

/**
 * Check if running in Electron main process.
 */
export function isElectronMain(): boolean {
  return detectEnvironment() === 'electron-main'
}

/**
 * Check if running in Electron renderer process.
 */
export function isElectronRenderer(): boolean {
  return detectEnvironment() === 'electron-renderer'
}
```

**Testing Scenarios:**
- ✅ Browser (Chrome, Firefox, Safari, Edge)
- ✅ Node.js (v16+)
- ✅ Electron main process
- ✅ Electron renderer process (with nodeIntegration)
- ✅ Electron renderer process (without nodeIntegration)

---

### PHASE 4: Provider Types (Week 2)

#### 4.1 Provider Type Definitions
**NEW FILE:** `packages/sdk/src/provider/types.ts` (~150 lines)

```typescript
import type { Vault, Balance, Chain } from '@vultisig/sdk'
import type { VaultStorage } from './storage/types'
import type { ProviderEvents } from './events/types'

/**
 * Configuration options for provider initialization.
 */
export interface ProviderConfig {
  /** Custom storage implementation (auto-selected if not provided) */
  storage?: VaultStorage

  /** Auto-initialize WASM modules on construction */
  autoInit?: boolean

  /** Auto-connect and load last active vault */
  autoConnect?: boolean

  /** Default chains to activate */
  defaultChains?: string[]

  /** Custom endpoint URLs */
  endpoints?: {
    fastVault?: string
    relay?: string
  }
}

/**
 * Options for connecting to a vault.
 */
export interface ConnectionOptions {
  /** Specific vault ID to load */
  vaultId?: string

  /** Password for encrypted vaults */
  password?: string
}

/**
 * Parameters for signing a transaction.
 */
export interface SignTransactionParams {
  /** Chain to sign for */
  chain: string

  /** Transaction data (chain-specific format) */
  transaction: any

  /** Password for local signing */
  password?: string

  /** Use fast signing (server-assisted 2-of-2) */
  fast?: boolean
}

/**
 * Parameters for sending a transaction.
 */
export interface SendTransactionParams extends SignTransactionParams {
  // Inherits all SignTransactionParams
}

/**
 * Parameters for signing a message.
 */
export interface SignMessageParams {
  chain: string
  message: string
  password?: string
}

/**
 * Parameters for signing typed data (EIP-712).
 */
export interface SignTypedDataParams {
  chain: string
  data: any
  password?: string
}

/**
 * Parameters for fetching balance.
 */
export interface GetBalanceParams {
  chain: string
  tokenId?: string
}

/**
 * Options for creating a vault.
 */
export interface VaultOptions {
  name: string
  password?: string
  email?: string
  fast?: boolean
}

/**
 * Vault summary information.
 */
export interface VaultSummary {
  id: string
  name: string
  createdAt: number
}

/**
 * Main provider interface.
 * All providers (Browser, Node, Electron) implement this interface.
 */
export interface VultisigProvider {
  // ============================================
  // Connection Management
  // ============================================

  /**
   * Connect to the provider and optionally load a vault.
   */
  connect(options?: ConnectionOptions): Promise<void>

  /**
   * Disconnect from the provider.
   */
  disconnect(): Promise<void>

  /**
   * Check if provider is connected.
   */
  isConnected(): boolean

  // ============================================
  // Account Management
  // ============================================

  /**
   * Get accounts for a specific chain or all chains.
   * Returns addresses controlled by the active vault.
   */
  getAccounts(chain?: string): Promise<string[]>

  /**
   * Get the active account address for a specific chain.
   */
  getActiveAccount(chain: string): Promise<string | null>

  // ============================================
  // Chain Management
  // ============================================

  /**
   * Get list of all supported chains.
   */
  getSupportedChains(): string[]

  /**
   * Set the active chain.
   */
  setActiveChain(chain: string): Promise<void>

  /**
   * Get the currently active chain.
   */
  getActiveChain(): string

  // ============================================
  // Transaction Operations
  // ============================================

  /**
   * Sign a transaction (does not broadcast).
   */
  signTransaction(params: SignTransactionParams): Promise<any>

  /**
   * Sign and broadcast a transaction.
   */
  sendTransaction(params: SendTransactionParams): Promise<string>

  // ============================================
  // Message Signing
  // ============================================

  /**
   * Sign a plain text message.
   */
  signMessage(params: SignMessageParams): Promise<string>

  /**
   * Sign typed data (EIP-712).
   */
  signTypedData(params: SignTypedDataParams): Promise<string>

  // ============================================
  // Balance Queries
  // ============================================

  /**
   * Get balance for a specific chain/token.
   */
  getBalance(params: GetBalanceParams): Promise<Balance>

  /**
   * Get balances for multiple chains.
   */
  getBalances(chains?: string[]): Promise<Record<string, Balance>>

  // ============================================
  // Vault Management
  // ============================================

  /**
   * Create a new vault.
   */
  createVault(options: VaultOptions): Promise<Vault>

  /**
   * Import a vault from file.
   */
  importVault(file: File | Buffer, password?: string): Promise<Vault>

  /**
   * List all available vaults.
   */
  listVaults(): Promise<VaultSummary[]>

  /**
   * Switch to a different vault.
   */
  switchVault(vaultId: string): Promise<void>

  /**
   * Delete a vault.
   */
  deleteVault(vaultId: string): Promise<void>

  // ============================================
  // Event Handling
  // ============================================

  /**
   * Register an event listener.
   */
  on<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): void

  /**
   * Register a one-time event listener.
   */
  once<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): void

  /**
   * Unregister an event listener.
   */
  off<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): void
}
```

---

### PHASE 5: Base Provider Implementation (Week 2-3)

#### 5.1 Base Provider Class
**NEW FILE:** `packages/sdk/src/provider/BaseProvider.ts` (~350 lines)

**Rationale:** BaseProvider implements the core provider logic that's common across all environments. Environment-specific providers (Browser, Node, Electron) extend this class.

**Key Design Decisions:**

1. **All Operations Delegate to SDK** - No reimplementation of any chain logic
2. **Events for Reactivity** - Emit events on state changes for UI updates
3. **Storage Integration** - Persist vaults to storage on create/import
4. **Error Propagation** - Use existing VaultError, emit 'error' events

**Implementation Outline:**

```typescript
import { VultisigSDK, Vault, VaultError } from '@vultisig/sdk'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { ProviderEvents } from './events/types'
import type { VultisigProvider, ProviderConfig, ConnectionOptions } from './types'
import { MemoryStorage } from './storage/MemoryStorage'

/**
 * Base provider implementation.
 * Environment-specific providers extend this class.
 */
export abstract class BaseProvider
  extends UniversalEventEmitter<ProviderEvents>
  implements VultisigProvider {

  protected sdk: VultisigSDK
  protected storage: VaultStorage
  protected activeVault: Vault | null = null
  protected connected = false

  constructor(config: ProviderConfig) {
    super()
    this.storage = config.storage ?? new MemoryStorage()
    this.sdk = new VultisigSDK(config.endpoints)

    if (config.autoInit) {
      // REUSE: WASMManager.initialize()
      this.sdk.initialize().catch(err => this.emit('error', err))
    }
  }

  // ============================================
  // Connection Management
  // ============================================

  async connect(options?: ConnectionOptions): Promise<void> {
    try {
      // REUSE: WASMManager initialization
      await this.sdk.initialize()

      if (options?.vaultId) {
        // Load specific vault
        const vaultData = await this.storage.get(options.vaultId)
        if (!vaultData) {
          throw new VaultError('Vault not found')
        }

        // REUSE: VaultManager.addVault()
        const vault = await this.sdk.vault.addVault(vaultData, options.password)
        this.activeVault = vault
      } else {
        // Auto-load last active vault
        const lastVaultId = await this.storage.get('activeVaultId')
        if (lastVaultId) {
          const vaultData = await this.storage.get(lastVaultId)
          if (vaultData) {
            const vault = await this.sdk.vault.addVault(vaultData)
            this.activeVault = vault
          }
        }
      }

      this.connected = true
      this.emit('connect', undefined)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.activeVault = null
    this.connected = false
    this.emit('disconnect', undefined)
  }

  isConnected(): boolean {
    return this.connected
  }

  // ============================================
  // Account Management
  // ============================================

  async getAccounts(chain?: string): Promise<string[]> {
    if (!this.activeVault) return []

    try {
      if (chain) {
        // REUSE: Vault.address() - has permanent caching
        const address = await this.activeVault.address(chain)
        return address ? [address] : []
      }

      // Get addresses for all active chains
      const chains = this.activeVault.getChains()

      // REUSE: Vault.addresses() - parallel fetch with caching
      const addresses = await this.activeVault.addresses(chains)
      return Object.values(addresses).filter(Boolean)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async getActiveAccount(chain: string): Promise<string | null> {
    if (!this.activeVault) return null

    try {
      // REUSE: Vault.address() - permanent cache
      return await this.activeVault.address(chain)
    } catch (error) {
      this.emit('error', error as Error)
      return null
    }
  }

  // ============================================
  // Chain Management
  // ============================================

  getSupportedChains(): string[] {
    // REUSE: Core Chain enum
    return Object.values(Chain)
  }

  async setActiveChain(chain: string): Promise<void> {
    await this.storage.set('activeChain', chain)
    this.emit('chainChanged', { chain })
  }

  getActiveChain(): string {
    // Sync operation - stored in memory
    return this.storage.get('activeChain') ?? Chain.Bitcoin
  }

  // ============================================
  // Transaction Operations
  // ============================================

  async signTransaction(params: SignTransactionParams): Promise<any> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    try {
      // REUSE: Vault.sign() → FastSigningService → MPC
      const mode = params.fast ? 'fast' : 'relay'
      return await this.activeVault.sign(mode, params.transaction, params.password)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async sendTransaction(params: SendTransactionParams): Promise<string> {
    try {
      // Sign transaction
      const signed = await this.signTransaction(params)

      // REUSE: Core broadcastTx function
      const txHash = await broadcastTx({
        chain: params.chain,
        signedTransaction: signed,
      })

      return txHash
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Message Signing
  // ============================================

  async signMessage(params: SignMessageParams): Promise<string> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    try {
      // REUSE: Vault.sign() with message payload
      return await this.activeVault.sign('local', {
        type: 'message',
        chain: params.chain,
        message: params.message,
      }, params.password)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async signTypedData(params: SignTypedDataParams): Promise<string> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    try {
      // REUSE: Vault.sign() with typed data payload
      return await this.activeVault.sign('local', {
        type: 'typedData',
        chain: params.chain,
        data: params.data,
      }, params.password)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Balance Queries
  // ============================================

  async getBalance(params: GetBalanceParams): Promise<Balance> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    try {
      // REUSE: Vault.balance() - has 5-min TTL cache
      const balance = await this.activeVault.balance(params.chain, params.tokenId)

      // Emit event for reactive updates
      this.emit('balanceUpdated', { chain: params.chain, balance })

      return balance
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async getBalances(chains?: string[]): Promise<Record<string, Balance>> {
    if (!this.activeVault) return {}

    try {
      const targetChains = chains ?? this.activeVault.getChains()

      // REUSE: Vault.balances() - parallel fetch with 5-min cache
      return await this.activeVault.balances(targetChains)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Vault Management
  // ============================================

  async createVault(options: VaultOptions): Promise<Vault> {
    try {
      // REUSE: VaultManager.createVault()
      const vault = await this.sdk.vault.createVault(options.name, options)

      // NEW: Persist to storage
      const vaultId = vault.data.publicKeys.ecdsa
      await this.storage.set(vaultId, vault.data)
      await this.storage.set('activeVaultId', vaultId)

      this.activeVault = vault
      this.emit('vaultChanged', { vaultId })

      return vault
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async importVault(file: File | Buffer, password?: string): Promise<Vault> {
    try {
      // REUSE: VaultManager.addVault()
      const vault = await this.sdk.vault.addVault(file, password)

      // NEW: Persist to storage
      const vaultId = vault.data.publicKeys.ecdsa
      await this.storage.set(vaultId, vault.data)
      await this.storage.set('activeVaultId', vaultId)

      this.activeVault = vault
      this.emit('vaultChanged', { vaultId })

      return vault
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async listVaults(): Promise<VaultSummary[]> {
    try {
      const keys = await this.storage.list()
      const summaries: VaultSummary[] = []

      for (const key of keys) {
        // Skip non-vault keys
        if (key === 'activeVaultId' || key === 'activeChain') continue

        const vaultData = await this.storage.get(key)
        if (vaultData && vaultData.name) {
          summaries.push({
            id: key,
            name: vaultData.name,
            createdAt: vaultData.createdAt || Date.now(),
          })
        }
      }

      return summaries
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async switchVault(vaultId: string): Promise<void> {
    try {
      const vaultData = await this.storage.get(vaultId)
      if (!vaultData) {
        throw new VaultError('Vault not found')
      }

      // REUSE: VaultManager.addVault()
      const vault = await this.sdk.vault.addVault(vaultData)
      this.activeVault = vault

      await this.storage.set('activeVaultId', vaultId)
      this.emit('vaultChanged', { vaultId })
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async deleteVault(vaultId: string): Promise<void> {
    try {
      await this.storage.remove(vaultId)

      if (this.activeVault?.data.publicKeys.ecdsa === vaultId) {
        this.activeVault = null
        await this.storage.remove('activeVaultId')
        this.emit('vaultChanged', { vaultId: '' })
      }
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }
}
```

**REUSES 100%:**
- ✅ VultisigSDK
- ✅ VaultManager (createVault, addVault)
- ✅ Vault (address, balance, sign)
- ✅ ServerManager (via Vault.sign)
- ✅ WASMManager (via SDK.initialize)
- ✅ Core functions (broadcastTx, Chain enum)
- ✅ VaultError

**NEW CODE:**
- ✅ Storage integration (set/get)
- ✅ Event emission
- ✅ Connection state management

---

### PHASE 6: Environment-Specific Providers (Week 3)

#### 6.1 Browser Provider
**NEW FILE:** `packages/sdk/src/provider/BrowserProvider.ts` (~80 lines)

```typescript
import { BaseProvider } from './BaseProvider'
import { BrowserStorage } from './storage/BrowserStorage'
import type { ProviderConfig } from './types'

/**
 * Provider optimized for browser environments.
 * Uses IndexedDB (primary) or localStorage (fallback).
 */
export class BrowserProvider extends BaseProvider {
  constructor(config: ProviderConfig = {}) {
    // Auto-select browser storage if not provided
    const storage = config.storage ?? new BrowserStorage()
    super({ ...config, storage })
  }

  /**
   * Export vault as Blob (browser-specific).
   * Can be used with download links or File API.
   */
  async exportVault(vaultId: string): Promise<Blob> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    // REUSE: Vault.export()
    const exported = await this.activeVault.export()

    return new Blob([exported], {
      type: 'application/octet-stream'
    })
  }

  /**
   * Download vault file (browser-specific).
   * Creates temporary download link and triggers download.
   */
  async downloadVault(vaultId: string, filename?: string): Promise<void> {
    const blob = await this.exportVault(vaultId)
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename ?? `${this.activeVault?.data.name}.vult`
    document.body.appendChild(a)
    a.click()

    // Cleanup
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
```

#### 6.2 Node.js Provider
**NEW FILE:** `packages/sdk/src/provider/NodeProvider.ts` (~100 lines)

```typescript
import { BaseProvider } from './BaseProvider'
import { NodeStorage } from './storage/NodeStorage'
import type { ProviderConfig } from './types'

/**
 * Provider optimized for Node.js environments.
 * Uses filesystem storage.
 */
export class NodeProvider extends BaseProvider {
  constructor(config: ProviderConfig = {}) {
    // Auto-select Node storage if not provided
    const storage = config.storage ?? new NodeStorage()
    super({ ...config, storage })
  }

  /**
   * Export vault to file (Node-specific).
   */
  async exportVaultToFile(
    vaultId: string,
    filePath: string
  ): Promise<void> {
    if (!this.activeVault) {
      throw new VaultError('No active vault')
    }

    const fs = await import('fs/promises')

    // REUSE: Vault.export()
    const exported = await this.activeVault.export()

    await fs.writeFile(filePath, exported)
  }

  /**
   * Import vault from file (Node-specific).
   */
  async importVaultFromFile(
    filePath: string,
    password?: string
  ): Promise<Vault> {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(filePath)

    // REUSE: BaseProvider.importVault()
    return await this.importVault(buffer, password)
  }

  /**
   * Get storage directory path.
   */
  getStoragePath(): string {
    return (this.storage as NodeStorage).basePath
  }
}
```

#### 6.3 Electron Provider
**NEW FILE:** `packages/sdk/src/provider/ElectronProvider.ts` (~130 lines)

```typescript
import { BaseProvider } from './BaseProvider'
import { BrowserStorage } from './storage/BrowserStorage'
import { NodeStorage } from './storage/NodeStorage'
import { detectEnvironment } from './environment'
import type { ProviderConfig, VaultOptions, GetBalanceParams } from './types'

/**
 * Provider optimized for Electron applications.
 * Automatically uses appropriate storage based on process type.
 */
export class ElectronProvider extends BaseProvider {
  private processType: 'main' | 'renderer'

  constructor(config: ProviderConfig = {}) {
    const env = detectEnvironment()
    this.processType = env === 'electron-main' ? 'main' : 'renderer'

    let storage: VaultStorage

    if (this.processType === 'main') {
      // Main process: Use filesystem with userData directory
      const { app } = require('electron')
      const basePath = app.getPath('userData') + '/.vultisig'
      storage = new NodeStorage({ basePath })
    } else {
      // Renderer process: Use IndexedDB
      storage = new BrowserStorage()
    }

    super({ ...config, storage: config.storage ?? storage })
  }

  /**
   * Get IPC handlers for use in main process.
   *
   * Example usage:
   * ```
   * const provider = new ElectronProvider()
   * provider.setupIPCHandlers(ipcMain)
   * ```
   */
  getIPCHandlers(): Record<string, Function> {
    if (this.processType !== 'main') {
      throw new Error('IPC handlers only available in main process')
    }

    return {
      'vault:connect': (options?: ConnectionOptions) =>
        this.connect(options),

      'vault:disconnect': () =>
        this.disconnect(),

      'vault:isConnected': () =>
        this.isConnected(),

      'vault:getAccounts': (chain?: string) =>
        this.getAccounts(chain),

      'vault:getActiveAccount': (chain: string) =>
        this.getActiveAccount(chain),

      'vault:getSupportedChains': () =>
        this.getSupportedChains(),

      'vault:getBalance': (params: GetBalanceParams) =>
        this.getBalance(params),

      'vault:getBalances': (chains?: string[]) =>
        this.getBalances(chains),

      'vault:signTransaction': (params: SignTransactionParams) =>
        this.signTransaction(params),

      'vault:sendTransaction': (params: SendTransactionParams) =>
        this.sendTransaction(params),

      'vault:signMessage': (params: SignMessageParams) =>
        this.signMessage(params),

      'vault:createVault': (options: VaultOptions) =>
        this.createVault(options),

      'vault:importVault': (file: Buffer, password?: string) =>
        this.importVault(file, password),

      'vault:listVaults': () =>
        this.listVaults(),

      'vault:switchVault': (vaultId: string) =>
        this.switchVault(vaultId),

      'vault:deleteVault': (vaultId: string) =>
        this.deleteVault(vaultId),
    }
  }

  /**
   * Setup all IPC handlers automatically.
   *
   * Usage in main.js:
   * ```
   * const provider = new ElectronProvider()
   * provider.setupIPCHandlers(ipcMain)
   * ```
   */
  setupIPCHandlers(ipcMain: any): void {
    const handlers = this.getIPCHandlers()

    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, async (event: any, ...args: any[]) => {
        try {
          return await handler(...args)
        } catch (error) {
          // Re-throw to be caught by renderer
          throw error
        }
      })
    }
  }

  /**
   * Get storage path (main process only).
   */
  getStoragePath(): string {
    if (this.processType !== 'main') {
      throw new Error('Storage path only available in main process')
    }
    return (this.storage as NodeStorage).basePath
  }
}
```

---

### PHASE 7: Factory & Auto-Detection (Week 3)

#### 7.1 Provider Factory
**NEW FILE:** `packages/sdk/src/provider/factory.ts` (~70 lines)

```typescript
import { detectEnvironment } from './environment'
import { BrowserProvider } from './BrowserProvider'
import { NodeProvider } from './NodeProvider'
import { ElectronProvider } from './ElectronProvider'
import type { ProviderConfig, VultisigProvider } from './types'

/**
 * Create a provider with automatic environment detection.
 *
 * This is the recommended way to create a provider.
 * The correct implementation will be selected based on the runtime environment.
 *
 * @example
 * ```typescript
 * const provider = await createProvider()
 * await provider.connect()
 * ```
 */
export async function createProvider(
  config: ProviderConfig = {}
): Promise<VultisigProvider> {
  const env = detectEnvironment()

  switch (env) {
    case 'browser':
      return new BrowserProvider(config)

    case 'node':
      return new NodeProvider(config)

    case 'electron-main':
    case 'electron-renderer':
      return new ElectronProvider(config)

    default:
      throw new Error(
        `Unsupported environment: ${env}. ` +
        `Provider supports browser, Node.js, and Electron.`
      )
  }
}

/**
 * Create a browser provider explicitly.
 * Use this when you want to force browser provider regardless of environment.
 */
export function createBrowserProvider(
  config?: ProviderConfig
): BrowserProvider {
  return new BrowserProvider(config)
}

/**
 * Create a Node.js provider explicitly.
 * Use this when you want to force Node provider regardless of environment.
 */
export function createNodeProvider(
  config?: ProviderConfig
): NodeProvider {
  return new NodeProvider(config)
}

/**
 * Create an Electron provider explicitly.
 * Use this when you want to force Electron provider regardless of environment.
 */
export function createElectronProvider(
  config?: ProviderConfig
): ElectronProvider {
  return new ElectronProvider(config)
}
```

#### 7.2 Main Export File
**NEW FILE:** `packages/sdk/src/provider/index.ts` (~40 lines)

```typescript
// ============================================
// Types & Interfaces
// ============================================
export * from './types'
export * from './events/types'

// ============================================
// Provider Implementations
// ============================================
export { BaseProvider } from './BaseProvider'
export { BrowserProvider } from './BrowserProvider'
export { NodeProvider } from './NodeProvider'
export { ElectronProvider } from './ElectronProvider'

// ============================================
// Factory Functions
// ============================================
export {
  createProvider,
  createBrowserProvider,
  createNodeProvider,
  createElectronProvider
} from './factory'

// ============================================
// Storage Abstraction
// ============================================
export type { VaultStorage } from './storage/types'
export { BrowserStorage } from './storage/BrowserStorage'
export { NodeStorage } from './storage/NodeStorage'
export { MemoryStorage } from './storage/MemoryStorage'

// ============================================
// Environment Detection
// ============================================
export * from './environment'

// ============================================
// Event System
// ============================================
export { UniversalEventEmitter } from './events/EventEmitter'
```

---

### PHASE 8: Testing (Week 4)

#### 8.1 Test Utilities
**NEW FILE:** `packages/sdk/src/provider/__tests__/utils.ts` (~80 lines)

```typescript
import { MemoryStorage } from '../storage/MemoryStorage'
import { BrowserProvider } from '../BrowserProvider'
import type { VaultStorage, ProviderConfig, VultisigProvider } from '../types'

/**
 * Create a mock storage for testing.
 * Simple in-memory implementation.
 */
export function createMockStorage(): VaultStorage {
  return new MemoryStorage()
}

/**
 * Create a test provider with mock storage.
 */
export async function createTestProvider(
  config?: Partial<ProviderConfig>
): Promise<VultisigProvider> {
  const storage = createMockStorage()
  return new BrowserProvider({ storage, ...config })
}

/**
 * Wait for a specific event to be emitted.
 * Useful for testing event-driven behavior.
 */
export function waitForEvent<T>(
  provider: VultisigProvider,
  event: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Event ${event} not emitted within ${timeout}ms`))
    }, timeout)

    provider.once(event as any, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

/**
 * Create mock vault data for testing.
 */
export function createMockVaultData(overrides?: Partial<any>) {
  return {
    name: 'Test Vault',
    publicKeys: {
      ecdsa: 'test-vault-id',
      eddsa: 'test-eddsa-key',
    },
    createdAt: Date.now(),
    ...overrides,
  }
}
```

#### 8.2 Storage Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/storage.test.ts` (~150 lines)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { BrowserStorage } from '../storage/BrowserStorage'
import { NodeStorage } from '../storage/NodeStorage'
import { MemoryStorage } from '../storage/MemoryStorage'

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('should store and retrieve values', async () => {
    await storage.set('key1', 'value1')
    const value = await storage.get('key1')
    expect(value).toBe('value1')
  })

  it('should return null for missing keys', async () => {
    const value = await storage.get('nonexistent')
    expect(value).toBeNull()
  })

  it('should list all keys', async () => {
    await storage.set('key1', 'value1')
    await storage.set('key2', 'value2')
    const keys = await storage.list()
    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
  })

  it('should remove values', async () => {
    await storage.set('key1', 'value1')
    await storage.remove('key1')
    const value = await storage.get('key1')
    expect(value).toBeNull()
  })

  it('should clear all values', async () => {
    await storage.set('key1', 'value1')
    await storage.set('key2', 'value2')
    await storage.clear()
    const keys = await storage.list()
    expect(keys).toHaveLength(0)
  })
})

// Similar tests for BrowserStorage and NodeStorage
// ...
```

#### 8.3 Provider Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/provider.test.ts` (~200 lines)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestProvider, waitForEvent } from './utils'

describe('Provider', () => {
  let provider: VultisigProvider

  beforeEach(async () => {
    provider = await createTestProvider()
  })

  describe('Connection', () => {
    it('should start disconnected', () => {
      expect(provider.isConnected()).toBe(false)
    })

    it('should connect and emit event', async () => {
      const connectPromise = waitForEvent(provider, 'connect')
      await provider.connect()
      await connectPromise
      expect(provider.isConnected()).toBe(true)
    })

    it('should disconnect and emit event', async () => {
      await provider.connect()
      const disconnectPromise = waitForEvent(provider, 'disconnect')
      await provider.disconnect()
      await disconnectPromise
      expect(provider.isConnected()).toBe(false)
    })
  })

  describe('Vault Management', () => {
    it('should create a vault', async () => {
      await provider.connect()
      const vault = await provider.createVault({ name: 'Test Vault' })
      expect(vault.data.name).toBe('Test Vault')
    })

    it('should list vaults', async () => {
      await provider.connect()
      await provider.createVault({ name: 'Vault 1' })
      await provider.createVault({ name: 'Vault 2' })
      const vaults = await provider.listVaults()
      expect(vaults).toHaveLength(2)
    })

    it('should emit vaultChanged on create', async () => {
      await provider.connect()
      const eventPromise = waitForEvent(provider, 'vaultChanged')
      await provider.createVault({ name: 'Test' })
      const event = await eventPromise
      expect(event.vaultId).toBeDefined()
    })
  })

  describe('Balance Queries', () => {
    it('should get balance for chain', async () => {
      await provider.connect()
      await provider.createVault({ name: 'Test' })

      const balance = await provider.getBalance({ chain: 'Ethereum' })
      expect(balance).toBeDefined()
      expect(balance.chain).toBe('Ethereum')
    })

    it('should emit balanceUpdated event', async () => {
      await provider.connect()
      await provider.createVault({ name: 'Test' })

      const eventPromise = waitForEvent(provider, 'balanceUpdated')
      await provider.getBalance({ chain: 'Ethereum' })
      const event = await eventPromise
      expect(event.chain).toBe('Ethereum')
    })
  })

  // More tests...
})
```

#### 8.4 Environment Detection Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/environment.test.ts` (~80 lines)

#### 8.5 Factory Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/factory.test.ts` (~60 lines)

#### 8.6 Electron Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/electron.test.ts` (~100 lines)

#### 8.7 Integration Tests
**NEW FILE:** `packages/sdk/src/provider/__tests__/integration.test.ts` (~150 lines)

---

### PHASE 9: Documentation & Examples (Week 5)

#### 9.1 Core Documentation
**NEW FILE:** `docs/provider/README.md`
**NEW FILE:** `docs/provider/API.md`

#### 9.2 Environment Guides
**NEW FILE:** `docs/provider/BROWSER.md`
**NEW FILE:** `docs/provider/NODEJS.md`
**NEW FILE:** `docs/provider/ELECTRON.md`

#### 9.3 Examples
**NEW DIR:** `examples/provider/vanilla-browser/`
**NEW DIR:** `examples/provider/node-cli/`
**NEW DIR:** `examples/provider/electron/`

#### 9.4 Migration Guide
**NEW FILE:** `docs/provider/MIGRATION.md`

---

### PHASE 10: Build Configuration (Week 5)

#### 10.1 Package Configuration
**UPDATE:** `packages/sdk/package.json`

```json
{
  "name": "@vultisig/sdk",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./provider": {
      "types": "./dist/provider/index.d.ts",
      "import": "./dist/provider/index.js",
      "require": "./dist/provider/index.cjs"
    }
  },
  "dependencies": {
    "@vultisig/core": "workspace:*",
    "@vultisig/lib": "workspace:*"
  },
  "optionalDependencies": {
    "idb": "^8.0.0"
  }
}
```

---

## File Structure

```
packages/sdk/src/
├── provider/                                # NEW - Provider layer
│   ├── types.ts                             # Provider types & interfaces (150 lines)
│   ├── BaseProvider.ts                      # Base provider implementation (350 lines)
│   ├── BrowserProvider.ts                   # Browser-specific provider (80 lines)
│   ├── NodeProvider.ts                      # Node.js-specific provider (100 lines)
│   ├── ElectronProvider.ts                  # Electron-specific provider (130 lines)
│   ├── factory.ts                           # Auto-detection factory (70 lines)
│   ├── environment.ts                       # Environment detection (60 lines)
│   ├── index.ts                             # Main exports (40 lines)
│   ├── events/
│   │   ├── EventEmitter.ts                  # Universal event emitter (80 lines)
│   │   └── types.ts                         # Event type definitions (30 lines)
│   ├── storage/
│   │   ├── types.ts                         # Storage interface (50 lines)
│   │   ├── BrowserStorage.ts                # IndexedDB + localStorage (150 lines)
│   │   ├── NodeStorage.ts                   # Filesystem storage (120 lines)
│   │   └── MemoryStorage.ts                 # In-memory storage (40 lines)
│   └── __tests__/
│       ├── utils.ts                         # Test utilities (80 lines)
│       ├── storage.test.ts                  # Storage tests (150 lines)
│       ├── provider.test.ts                 # Provider tests (200 lines)
│       ├── environment.test.ts              # Environment tests (80 lines)
│       ├── factory.test.ts                  # Factory tests (60 lines)
│       ├── electron.test.ts                 # Electron tests (100 lines)
│       └── integration.test.ts              # Integration tests (150 lines)
├── (existing SDK files - unchanged)

docs/
├── provider/                                # NEW - Provider documentation
│   ├── README.md                            # Main provider guide (600 lines)
│   ├── API.md                               # API reference (400 lines)
│   ├── BROWSER.md                           # Browser guide (250 lines)
│   ├── NODEJS.md                            # Node.js guide (250 lines)
│   ├── ELECTRON.md                          # Electron guide (400 lines)
│   └── MIGRATION.md                         # Migration guide (200 lines)

examples/
├── provider/                                # NEW - Provider examples
│   ├── vanilla-browser/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── README.md
│   ├── node-cli/
│   │   ├── index.ts
│   │   ├── package.json
│   │   └── README.md
│   └── electron/
│       ├── main.js
│       ├── preload.js
│       ├── renderer/
│       │   ├── index.html
│       │   └── app.js
│       ├── package.json
│       └── README.md
```

**Total New Files:** 17 implementation + 6 test + 6 docs + 3 examples = **32 files**
**Total New LOC:** ~1800 implementation + ~820 tests + ~2500 docs = **~5100 total**

---

## Dependencies

### Required Dependencies
**None** - Provider works with zero external dependencies beyond existing SDK dependencies.

### Optional Dependencies
```json
{
  "idb": "^8.0.0"  // IndexedDB helper (can use native API instead)
}
```

**Why Optional:**
- Provider can use native IndexedDB API
- `idb` provides nicer TypeScript types and error handling
- Users who don't need IndexedDB (Node.js only) won't install it

### Peer Dependencies
**None** - No framework dependencies.

**Future (Optional Packages):**
- `@vultisig/provider-react` - React hooks
- `@vultisig/provider-vue` - Vue composables
- `@vultisig/provider-svelte` - Svelte stores

---

## Testing Strategy

### Unit Tests (~80% coverage target)
- Storage implementations (all adapters)
- Event emitter (on, once, off, emit)
- Environment detection (all scenarios)
- Provider state management
- Factory functions

### Integration Tests
- Full vault lifecycle (create → use → delete)
- Storage persistence (save → reload)
- Event propagation (emit → handler)
- Multi-vault management

### Test Infrastructure
- **Vitest** for test runner (already configured)
- Mock storage for isolated tests
- Test utilities for common patterns
- Fake-indexeddb for browser storage tests (optional)

### Manual Testing
- Browser: Chrome, Firefox, Safari, Edge
- Node.js: v16, v18, v20
- Electron: v25+

---

## Success Criteria

### Functional Requirements
- ✅ Provider works in browser, Node.js, and Electron
- ✅ All operations delegate to existing SDK (no duplication)
- ✅ Vault persistence across sessions
- ✅ Event-driven state updates
- ✅ Auto-environment detection
- ✅ Electron userData directory support
- ✅ Type-safe TypeScript API

### Quality Requirements
- ✅ <2000 LOC new implementation code
- ✅ >80% test coverage
- ✅ Zero framework dependencies
- ✅ All tests passing
- ✅ No breaking changes to existing SDK

### Documentation Requirements
- ✅ API reference for all methods
- ✅ Environment-specific guides
- ✅ Working examples for each environment
- ✅ Migration guide from direct SDK

### Performance Requirements
- ✅ Operations complete in <100ms (inherited from SDK)
- ✅ Storage operations <50ms (IndexedDB/filesystem)
- ✅ Event emission <1ms

---

## Timeline & Milestones

### Week 1: Foundation (Storage + Events)
**Deliverables:**
- ✅ Storage interface and all implementations
- ✅ Event emitter and event types
- ✅ Environment detection
- ✅ Unit tests for storage and events

**Success Criteria:**
- All storage tests passing
- Environment correctly detected in all scenarios

---

### Week 2: Provider Core
**Deliverables:**
- ✅ Provider types and interfaces
- ✅ BaseProvider implementation
- ✅ Initial provider tests

**Success Criteria:**
- BaseProvider methods delegate to SDK correctly
- Events emitted on state changes
- Connection lifecycle works

---

### Week 3: Environment Providers
**Deliverables:**
- ✅ BrowserProvider
- ✅ NodeProvider
- ✅ ElectronProvider
- ✅ Factory functions
- ✅ Provider exports

**Success Criteria:**
- Each provider works in its target environment
- Factory auto-selects correct provider
- Electron IPC helpers functional

---

### Week 4: Testing
**Deliverables:**
- ✅ Complete unit test suite
- ✅ Integration tests
- ✅ >80% code coverage

**Success Criteria:**
- All tests passing
- Edge cases covered
- No memory leaks in event system

---

### Week 5: Documentation & Polish
**Deliverables:**
- ✅ API documentation
- ✅ Environment guides
- ✅ Code examples
- ✅ Migration guide
- ✅ Build configuration

**Success Criteria:**
- Documentation covers all use cases
- Examples run successfully
- Package exports configured correctly
- Ready for release

---

## Risk Assessment & Mitigation

### LOW RISK: Maximum Code Reuse
**Risk:** Introducing bugs through new code
**Mitigation:** 90% code reuse means we're using battle-tested implementations

### LOW RISK: Framework Agnostic
**Risk:** Framework-specific issues
**Mitigation:** Zero framework dependencies, works everywhere

### MEDIUM RISK: Storage Compatibility
**Risk:** IndexedDB/localStorage quota issues
**Mitigation:** Automatic fallback chain (IndexedDB → localStorage → memory)

### MEDIUM RISK: Electron Detection
**Risk:** Incorrect process type detection
**Mitigation:** Robust detection logic, explicit factory functions available

### LOW RISK: Event Memory Leaks
**Risk:** Event listeners not cleaned up
**Mitigation:** Max listener warnings, documentation of cleanup patterns

---

## Comparison: Original Plan vs. Refined Plan

| Aspect | Original Plan | Refined Plan | Improvement |
|--------|--------------|--------------|-------------|
| **Timeline** | 16 weeks | 5 weeks | **69% faster** |
| **New LOC** | ~5000 | ~1800 | **64% less code** |
| **Code Reuse** | 40% | 90% | **125% more reuse** |
| **Dependencies** | Multiple (React, eventemitter3, etc.) | Zero framework deps | **Simpler** |
| **Framework Lock-in** | React-focused | Framework-agnostic | **Universal** |
| **Electron Support** | Not included | Fully integrated | **Added** |
| **Risk Level** | High | Low | **Much safer** |
| **Maintenance** | High (parallel impls) | Low (delegates to SDK) | **Easier** |

---

## Conclusion

This implementation plan delivers a **production-ready unified provider** in **5 weeks** with **1800 lines of new code** by maximizing reuse of the existing, battle-tested Vultisig SDK infrastructure.

The provider is:
- ✅ **Framework-agnostic** - Works everywhere without lock-in
- ✅ **Environment-aware** - Auto-detects browser, Node.js, Electron
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Event-driven** - Real-time updates without polling
- ✅ **Well-tested** - >80% coverage with comprehensive tests
- ✅ **Future-proof** - Framework integrations can be added later

By leveraging existing code and avoiding duplication, we achieve:
- 🚀 Faster delivery (5 weeks vs 16 weeks)
- 🎯 Lower risk (proven implementations)
- 🛠️ Easier maintenance (one source of truth)
- 📦 Smaller bundle (no unnecessary code)

**The provider is ready to implement.**
