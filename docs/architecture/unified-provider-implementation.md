# Unified Provider Library Implementation Guide

## Executive Summary

This document provides a complete implementation guide for creating a unified provider library for the Vultisig SDK. The library will enable both browser and Node.js applications to interact with Vultisig vaults through a consistent, programmatic API similar to Web3 providers.

### Key Features
- **Unified API** across browser and Node.js environments
- **Automatic environment detection** with appropriate provider selection
- **Storage abstraction** supporting IndexedDB, localStorage, and filesystem
- **Extension integration** with embedded vault fallback
- **Fully programmatic** - no user prompts in the SDK
- **Type-safe** TypeScript implementation
- **Event-driven** architecture for state changes

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Application Layer                            │
│                    (React, Vue, Node.js apps)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ uses
┌──────────────────────────────▼──────────────────────────────────────┐
│                      VultisigProvider Interface                      │
│              (Unified API for all environments)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ implements
        ┌──────────────────────┴──────────────────────┐
        │                                              │
┌───────▼──────────┐                      ┌───────────▼───────────┐
│ BrowserProvider  │                      │    NodeProvider       │
│                  │                      │                       │
│ • Extension API  │                      │ • File system access  │
│ • IndexedDB      │                      │ • Direct SDK usage    │
│ • Web Storage    │                      │ • Vault management    │
└───────┬──────────┘                      └───────────┬───────────┘
        │                                              │
        └──────────────────┬──────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────────────┐
│                        Vultisig SDK Core                             │
│            (Vault, signing, multi-chain support)                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase Overview
1. **Core Infrastructure** - Base types, interfaces, and utilities
2. **Storage Abstraction** - Environment-agnostic storage layer
3. **Provider Implementations** - Browser and Node.js providers
4. **Factory & Integration** - Provider factory and SDK integration
5. **Testing & Documentation** - Comprehensive tests and docs

---

## Phase 1: Core Infrastructure

### 1.1 Type Definitions

**File:** `packages/sdk/src/provider/types.ts`

```typescript
// ============================================
// Core Provider Interface
// ============================================

export interface VultisigProvider {
  // Connection Management
  connect(options?: ConnectionOptions): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Account Management
  getAccounts(chain?: string): Promise<string[]>
  getActiveAccount(chain: string): Promise<string | null>

  // Chain Management
  getSupportedChains(): string[]
  setActiveChain(chain: string): Promise<void>
  getActiveChain(): string

  // Transaction Operations
  signTransaction(params: SignTransactionParams): Promise<SignedTransaction>
  sendTransaction(params: SendTransactionParams): Promise<TransactionHash>

  // Message Signing
  signMessage(params: SignMessageParams): Promise<string>
  signTypedData(params: SignTypedDataParams): Promise<string>

  // Balance Queries
  getBalance(params: GetBalanceParams): Promise<Balance>
  getBalances(chains?: string[]): Promise<Record<string, Balance>>

  // Event Handling
  on(event: 'connect', handler: () => void): void
  on(event: 'disconnect', handler: () => void): void
  on(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  on(event: 'chainChanged', handler: (chain: string) => void): void
  off(event: string, handler: Function): void

  // Vault Management (optional - Node.js primarily)
  hasVaultManagement(): boolean
  loadVault?(vaultId: string, password?: string): Promise<void>
  listVaults?(): Promise<VaultSummary[]>
  createVault?(options: CreateVaultOptions): Promise<string>
  deleteVault?(vaultId: string): Promise<void>
  exportVault?(vaultId: string, outputPath: string): Promise<void>
  importVault?(inputPath: string, password?: string): Promise<string>
}

// ============================================
// Connection Options
// ============================================

export interface ConnectionOptions {
  // Browser-specific options
  extensionId?: string           // Chrome extension ID
  forceEmbedded?: boolean        // Skip extension, use embedded vault

  // Node.js-specific options
  vaultId?: string               // Vault ID to load from storage
  vaultPath?: string             // Direct path to vault file
  password?: string              // Vault password
  storageDir?: string            // Custom storage directory

  // Common options
  chains?: string[]              // Chains to enable
  autoConnect?: boolean          // Auto-connect on creation
  sdkConfig?: any               // SDK configuration
}

// ============================================
// Transaction Parameters
// ============================================

export interface SignTransactionParams {
  chain: string
  transaction: any               // Chain-specific transaction format
  signingMode?: 'fast' | 'secure'
  password?: string              // Optional password for signing
}

export interface SendTransactionParams extends SignTransactionParams {
  broadcast?: boolean            // Whether to broadcast after signing
}

export interface SignedTransaction {
  signature: string
  signedTransaction: string     // Encoded signed transaction
  transactionHash?: string       // If broadcast
}

export type TransactionHash = string

// ============================================
// Message Signing Parameters
// ============================================

export interface SignMessageParams {
  chain: string
  message: string
  account?: string               // Specific account to sign with
}

export interface SignTypedDataParams {
  chain: string
  domain: TypedDataDomain
  types: Record<string, TypedDataField[]>
  primaryType: string
  message: Record<string, any>
  account?: string
}

export interface TypedDataDomain {
  name?: string
  version?: string
  chainId?: number
  verifyingContract?: string
  salt?: string
}

export interface TypedDataField {
  name: string
  type: string
}

// ============================================
// Balance Parameters
// ============================================

export interface GetBalanceParams {
  chain: string
  account?: string               // Defaults to active account
  tokenId?: string              // For token balances
}

export interface Balance {
  amount: string                // Amount in smallest unit
  decimals: number
  formatted: string             // Human-readable format
  symbol?: string
  usdValue?: string
}

// ============================================
// Vault Management
// ============================================

export interface VaultSummary {
  id: string
  name: string
  createdAt: number
  lastAccessed: number
  chains?: string[]
}

export interface CreateVaultOptions {
  name: string
  email: string
  password: string
  chains: string[]
  mode?: 'fast' | 'secure'
}

// ============================================
// Provider Events
// ============================================

export type ProviderEvent =
  | 'connect'
  | 'disconnect'
  | 'accountsChanged'
  | 'chainChanged'
  | 'message'
  | 'error'

export interface ProviderEventMap {
  connect: []
  disconnect: []
  accountsChanged: [accounts: string[]]
  chainChanged: [chain: string]
  message: [message: ProviderMessage]
  error: [error: Error]
}

export interface ProviderMessage {
  type: string
  data: any
}

// ============================================
// Error Types
// ============================================

export class ProviderError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: any
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export const ProviderErrorCode = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  INTERNAL_ERROR: -32603,
} as const
```

### 1.2 Environment Detection

**File:** `packages/sdk/src/provider/environment.ts`

```typescript
/**
 * Detects the current runtime environment
 */
export type RuntimeEnvironment = 'browser' | 'node' | 'worker' | 'unknown'

export function detectEnvironment(): RuntimeEnvironment {
  // Check for browser environment
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    return 'browser'
  }

  // Check for Node.js environment
  if (typeof process !== 'undefined' &&
      process.versions &&
      process.versions.node) {
    return 'node'
  }

  // Check for Web Worker environment
  if (typeof self !== 'undefined' &&
      typeof WorkerGlobalScope !== 'undefined' &&
      self instanceof WorkerGlobalScope) {
    return 'worker'
  }

  return 'unknown'
}

/**
 * Environment feature detection utilities
 */
export const EnvironmentFeatures = {
  isBrowser(): boolean {
    return detectEnvironment() === 'browser'
  },

  isNode(): boolean {
    return detectEnvironment() === 'node'
  },

  isWorker(): boolean {
    return detectEnvironment() === 'worker'
  },

  hasExtensionSupport(): boolean {
    return typeof chrome !== 'undefined' &&
           typeof chrome.runtime !== 'undefined' &&
           typeof chrome.runtime.sendMessage === 'function'
  },

  hasIndexedDB(): boolean {
    return typeof indexedDB !== 'undefined'
  },

  hasLocalStorage(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return false
      }
      const test = '__test__'
      window.localStorage.setItem(test, test)
      window.localStorage.removeItem(test)
      return true
    } catch {
      return false
    }
  },

  hasSessionStorage(): boolean {
    try {
      if (typeof window === 'undefined' || !window.sessionStorage) {
        return false
      }
      const test = '__test__'
      window.sessionStorage.setItem(test, test)
      window.sessionStorage.removeItem(test)
      return true
    } catch {
      return false
    }
  },

  hasFileSystem(): boolean {
    return detectEnvironment() === 'node'
  },

  hasWebSocket(): boolean {
    return typeof WebSocket !== 'undefined'
  },

  hasCrypto(): boolean {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return true
    }
    // Node.js crypto
    if (typeof require !== 'undefined') {
      try {
        require('crypto')
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Get environment-specific global object
 */
export function getGlobalObject(): any {
  if (typeof window !== 'undefined') {
    return window
  }
  if (typeof global !== 'undefined') {
    return global
  }
  if (typeof self !== 'undefined') {
    return self
  }
  return {}
}
```

### 1.3 Universal Event Emitter

**File:** `packages/sdk/src/provider/events/EventEmitter.ts`

```typescript
import { ProviderEvent, ProviderEventMap } from '../types'

export type EventHandler<E extends ProviderEvent = ProviderEvent> =
  (...args: ProviderEventMap[E]) => void

/**
 * Universal event emitter that works in all environments
 */
export abstract class UniversalEventEmitter {
  private events: Map<string, Set<Function>> = new Map()
  private maxListeners: number = 10

  /**
   * Add event listener
   */
  on(event: string, handler: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }

    const handlers = this.events.get(event)!

    // Warn if too many listeners
    if (handlers.size >= this.maxListeners) {
      console.warn(
        `Warning: ${event} has ${handlers.size} listeners. ` +
        `Possible memory leak detected.`
      )
    }

    handlers.add(handler)
  }

  /**
   * Add one-time event listener
   */
  once(event: string, handler: Function): void {
    const wrappedHandler = (...args: any[]) => {
      handler(...args)
      this.off(event, wrappedHandler)
    }
    this.on(event, wrappedHandler)
  }

  /**
   * Remove event listener
   */
  off(event: string, handler: Function): void {
    this.events.get(event)?.delete(handler)

    // Clean up empty event sets
    if (this.events.get(event)?.size === 0) {
      this.events.delete(event)
    }
  }

  /**
   * Emit event to all listeners
   */
  protected emit(event: string, ...args: any[]): void {
    const handlers = this.events.get(event)

    if (!handlers || handlers.size === 0) {
      return
    }

    // Clone handlers to allow modification during iteration
    const handlersCopy = Array.from(handlers)

    for (const handler of handlersCopy) {
      try {
        handler(...args)
      } catch (error) {
        console.error(`Error in event handler for "${event}":`, error)
        // Emit error event if not already handling an error
        if (event !== 'error') {
          this.emit('error', error)
        }
      }
    }
  }

  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.events.get(event)?.size || 0
  }

  /**
   * Get all event names with listeners
   */
  eventNames(): string[] {
    return Array.from(this.events.keys())
  }

  /**
   * Set maximum number of listeners per event
   */
  setMaxListeners(n: number): void {
    this.maxListeners = n
  }
}
```

---

## Phase 2: Storage Abstraction

### 2.1 Storage Interface

**File:** `packages/sdk/src/provider/storage/VaultStorage.ts`

```typescript
/**
 * Abstract storage interface for vault data
 * Implementations handle browser vs Node.js storage
 */
export interface VaultStorage {
  // Core Operations
  save(vaultId: string, data: VaultData): Promise<void>
  load(vaultId: string): Promise<VaultData>
  list(): Promise<VaultSummary[]>
  delete(vaultId: string): Promise<void>
  exists(vaultId: string): Promise<boolean>

  // Metadata Operations
  saveMetadata(vaultId: string, metadata: VaultMetadata): Promise<void>
  loadMetadata(vaultId: string): Promise<VaultMetadata | null>

  // Storage Management
  initialize(): Promise<void>
  clear(): Promise<void>
  getStorageInfo(): Promise<StorageInfo>
}

export interface VaultData {
  vaultContainer: string        // Encrypted vault data (base64 or JSON string)
  version: number               // Storage format version
  timestamp: number             // Last modified timestamp
  checksum?: string            // Optional data integrity check
}

export interface VaultMetadata {
  id: string
  name: string
  description?: string
  createdAt: number
  lastAccessed: number
  lastModified: number
  chains: string[]
  addresses?: Record<string, string>  // Chain -> address mapping
  tags?: string[]
}

export interface VaultSummary {
  id: string
  name: string
  createdAt: number
  lastAccessed: number
  chains?: string[]
}

export interface StorageInfo {
  type: 'indexeddb' | 'localstorage' | 'filesystem' | 'memory'
  available: boolean
  used?: number                // Bytes used
  quota?: number              // Total bytes available
  vaultCount: number
}

/**
 * Base storage class with common functionality
 */
export abstract class BaseVaultStorage implements VaultStorage {
  protected initialized: boolean = false

  abstract save(vaultId: string, data: VaultData): Promise<void>
  abstract load(vaultId: string): Promise<VaultData>
  abstract list(): Promise<VaultSummary[]>
  abstract delete(vaultId: string): Promise<void>
  abstract exists(vaultId: string): Promise<boolean>
  abstract saveMetadata(vaultId: string, metadata: VaultMetadata): Promise<void>
  abstract loadMetadata(vaultId: string): Promise<VaultMetadata | null>
  abstract clear(): Promise<void>
  abstract getStorageInfo(): Promise<StorageInfo>

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.doInitialize()
    this.initialized = true
  }

  protected abstract doInitialize(): Promise<void>

  /**
   * Generate checksum for data integrity
   */
  protected async generateChecksum(data: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder()
      const dataBuffer = encoder.encode(data)
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }
    // Fallback for environments without crypto
    return ''
  }

  /**
   * Verify data integrity using checksum
   */
  protected async verifyChecksum(data: string, checksum?: string): Promise<boolean> {
    if (!checksum) return true
    const calculatedChecksum = await this.generateChecksum(data)
    return calculatedChecksum === checksum
  }
}
```

### 2.2 Browser Storage Implementation

**File:** `packages/sdk/src/provider/storage/BrowserStorage.ts`

```typescript
import {
  BaseVaultStorage,
  VaultData,
  VaultMetadata,
  VaultSummary,
  StorageInfo
} from './VaultStorage'
import { EnvironmentFeatures } from '../environment'

/**
 * Browser storage implementation with IndexedDB and localStorage fallback
 */
export class BrowserStorage extends BaseVaultStorage {
  private dbName = 'vultisig_provider_storage'
  private dbVersion = 1
  private db: IDBDatabase | null = null
  private storageType: 'indexeddb' | 'localstorage' | 'memory' = 'memory'
  private memoryStorage: Map<string, any> = new Map()

  protected async doInitialize(): Promise<void> {
    // Try IndexedDB first
    if (EnvironmentFeatures.hasIndexedDB()) {
      try {
        await this.initIndexedDB()
        this.storageType = 'indexeddb'
        return
      } catch (error) {
        console.warn('IndexedDB initialization failed:', error)
      }
    }

    // Fallback to localStorage
    if (EnvironmentFeatures.hasLocalStorage()) {
      this.storageType = 'localstorage'
      console.info('Using localStorage for vault storage')
      return
    }

    // Final fallback to memory
    this.storageType = 'memory'
    console.warn('No persistent storage available - using memory storage')
  }

  private async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => {
        reject(new Error(`IndexedDB error: ${request.error?.message}`))
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create vaults object store
        if (!db.objectStoreNames.contains('vaults')) {
          const vaultsStore = db.createObjectStore('vaults', { keyPath: 'id' })
          vaultsStore.createIndex('timestamp', 'timestamp', { unique: false })
        }

        // Create metadata object store
        if (!db.objectStoreNames.contains('metadata')) {
          const metadataStore = db.createObjectStore('metadata', { keyPath: 'id' })
          metadataStore.createIndex('name', 'name', { unique: false })
          metadataStore.createIndex('createdAt', 'createdAt', { unique: false })
          metadataStore.createIndex('lastAccessed', 'lastAccessed', { unique: false })
        }
      }
    })
  }

  async save(vaultId: string, data: VaultData): Promise<void> {
    await this.initialize()

    // Add checksum for data integrity
    data.checksum = await this.generateChecksum(data.vaultContainer)

    switch (this.storageType) {
      case 'indexeddb':
        await this.saveToIndexedDB(vaultId, data)
        break

      case 'localstorage':
        await this.saveToLocalStorage(vaultId, data)
        break

      case 'memory':
        this.memoryStorage.set(`vault_${vaultId}`, data)
        break
    }
  }

  private async saveToIndexedDB(vaultId: string, data: VaultData): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vaults'], 'readwrite')
      const store = transaction.objectStore('vaults')

      const request = store.put({ id: vaultId, ...data })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(`Failed to save vault: ${request.error}`))

      transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error}`))
    })
  }

  private async saveToLocalStorage(vaultId: string, data: VaultData): Promise<void> {
    const key = `vault_${vaultId}`

    try {
      const serialized = JSON.stringify(data)
      localStorage.setItem(key, serialized)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        // Try to clean up old data
        await this.cleanupLocalStorage()

        // Retry once
        try {
          localStorage.setItem(key, JSON.stringify(data))
        } catch {
          throw new Error('Storage quota exceeded. Please clear some space.')
        }
      } else {
        throw error
      }
    }
  }

  private async cleanupLocalStorage(): Promise<void> {
    // Remove oldest vaults if storage is full
    const vaults: { id: string; lastAccessed: number }[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('vault_metadata_')) {
        try {
          const metadata = JSON.parse(localStorage.getItem(key)!)
          vaults.push({
            id: key.replace('vault_metadata_', ''),
            lastAccessed: metadata.lastAccessed || 0
          })
        } catch {}
      }
    }

    // Sort by last accessed and remove oldest
    vaults.sort((a, b) => a.lastAccessed - b.lastAccessed)

    if (vaults.length > 0) {
      const toRemove = vaults[0]
      localStorage.removeItem(`vault_${toRemove.id}`)
      localStorage.removeItem(`vault_metadata_${toRemove.id}`)
      console.info(`Removed oldest vault ${toRemove.id} to free up space`)
    }
  }

  async load(vaultId: string): Promise<VaultData> {
    await this.initialize()

    let data: VaultData | null = null

    switch (this.storageType) {
      case 'indexeddb':
        data = await this.loadFromIndexedDB(vaultId)
        break

      case 'localstorage':
        data = await this.loadFromLocalStorage(vaultId)
        break

      case 'memory':
        data = this.memoryStorage.get(`vault_${vaultId}`) || null
        break
    }

    if (!data) {
      throw new Error(`Vault ${vaultId} not found`)
    }

    // Verify checksum if present
    if (data.checksum) {
      const valid = await this.verifyChecksum(data.vaultContainer, data.checksum)
      if (!valid) {
        throw new Error(`Vault ${vaultId} data integrity check failed`)
      }
    }

    return data
  }

  private async loadFromIndexedDB(vaultId: string): Promise<VaultData | null> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vaults'], 'readonly')
      const store = transaction.objectStore('vaults')
      const request = store.get(vaultId)

      request.onsuccess = () => {
        const result = request.result
        if (result) {
          const { id, ...data } = result
          resolve(data as VaultData)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => reject(new Error(`Failed to load vault: ${request.error}`))
    })
  }

  private async loadFromLocalStorage(vaultId: string): Promise<VaultData | null> {
    const key = `vault_${vaultId}`
    const item = localStorage.getItem(key)

    if (!item) return null

    try {
      return JSON.parse(item) as VaultData
    } catch {
      throw new Error(`Failed to parse vault data for ${vaultId}`)
    }
  }

  async list(): Promise<VaultSummary[]> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        return this.listFromIndexedDB()

      case 'localstorage':
        return this.listFromLocalStorage()

      case 'memory':
        return this.listFromMemory()
    }
  }

  private async listFromIndexedDB(): Promise<VaultSummary[]> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly')
      const store = transaction.objectStore('metadata')
      const request = store.getAll()

      request.onsuccess = () => {
        const results = request.result || []
        resolve(results.map(m => ({
          id: m.id,
          name: m.name,
          createdAt: m.createdAt,
          lastAccessed: m.lastAccessed,
          chains: m.chains
        })))
      }

      request.onerror = () => reject(new Error(`Failed to list vaults: ${request.error}`))
    })
  }

  private async listFromLocalStorage(): Promise<VaultSummary[]> {
    const summaries: VaultSummary[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('vault_metadata_')) {
        try {
          const metadata = JSON.parse(localStorage.getItem(key)!)
          summaries.push({
            id: metadata.id,
            name: metadata.name,
            createdAt: metadata.createdAt,
            lastAccessed: metadata.lastAccessed,
            chains: metadata.chains
          })
        } catch {}
      }
    }

    return summaries
  }

  private async listFromMemory(): Promise<VaultSummary[]> {
    const summaries: VaultSummary[] = []

    for (const [key, value] of this.memoryStorage) {
      if (key.startsWith('vault_metadata_')) {
        summaries.push({
          id: value.id,
          name: value.name,
          createdAt: value.createdAt,
          lastAccessed: value.lastAccessed,
          chains: value.chains
        })
      }
    }

    return summaries
  }

  async delete(vaultId: string): Promise<void> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        await this.deleteFromIndexedDB(vaultId)
        break

      case 'localstorage':
        localStorage.removeItem(`vault_${vaultId}`)
        localStorage.removeItem(`vault_metadata_${vaultId}`)
        break

      case 'memory':
        this.memoryStorage.delete(`vault_${vaultId}`)
        this.memoryStorage.delete(`vault_metadata_${vaultId}`)
        break
    }
  }

  private async deleteFromIndexedDB(vaultId: string): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vaults', 'metadata'], 'readwrite')

      transaction.objectStore('vaults').delete(vaultId)
      transaction.objectStore('metadata').delete(vaultId)

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error(`Failed to delete vault: ${transaction.error}`))
    })
  }

  async exists(vaultId: string): Promise<boolean> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        return this.existsInIndexedDB(vaultId)

      case 'localstorage':
        return localStorage.getItem(`vault_${vaultId}`) !== null

      case 'memory':
        return this.memoryStorage.has(`vault_${vaultId}`)
    }
  }

  private async existsInIndexedDB(vaultId: string): Promise<boolean> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vaults'], 'readonly')
      const store = transaction.objectStore('vaults')
      const request = store.count(vaultId)

      request.onsuccess = () => resolve(request.result > 0)
      request.onerror = () => reject(new Error(`Failed to check vault existence: ${request.error}`))
    })
  }

  async saveMetadata(vaultId: string, metadata: VaultMetadata): Promise<void> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        await this.saveMetadataToIndexedDB(metadata)
        break

      case 'localstorage':
        localStorage.setItem(`vault_metadata_${vaultId}`, JSON.stringify(metadata))
        break

      case 'memory':
        this.memoryStorage.set(`vault_metadata_${vaultId}`, metadata)
        break
    }
  }

  private async saveMetadataToIndexedDB(metadata: VaultMetadata): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['metadata'], 'readwrite')
      const store = transaction.objectStore('metadata')
      const request = store.put(metadata)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(`Failed to save metadata: ${request.error}`))
    })
  }

  async loadMetadata(vaultId: string): Promise<VaultMetadata | null> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        return this.loadMetadataFromIndexedDB(vaultId)

      case 'localstorage':
        const item = localStorage.getItem(`vault_metadata_${vaultId}`)
        return item ? JSON.parse(item) : null

      case 'memory':
        return this.memoryStorage.get(`vault_metadata_${vaultId}`) || null
    }
  }

  private async loadMetadataFromIndexedDB(vaultId: string): Promise<VaultMetadata | null> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly')
      const store = transaction.objectStore('metadata')
      const request = store.get(vaultId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(new Error(`Failed to load metadata: ${request.error}`))
    })
  }

  async clear(): Promise<void> {
    await this.initialize()

    switch (this.storageType) {
      case 'indexeddb':
        await this.clearIndexedDB()
        break

      case 'localstorage':
        // Remove all vault-related items
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith('vault_')) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key))
        break

      case 'memory':
        this.memoryStorage.clear()
        break
    }
  }

  private async clearIndexedDB(): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['vaults', 'metadata'], 'readwrite')

      transaction.objectStore('vaults').clear()
      transaction.objectStore('metadata').clear()

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error(`Failed to clear storage: ${transaction.error}`))
    })
  }

  async getStorageInfo(): Promise<StorageInfo> {
    await this.initialize()

    const vaultCount = (await this.list()).length

    switch (this.storageType) {
      case 'indexeddb':
        // Try to get storage estimate if available
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          const estimate = await navigator.storage.estimate()
          return {
            type: 'indexeddb',
            available: true,
            used: estimate.usage,
            quota: estimate.quota,
            vaultCount
          }
        }
        return {
          type: 'indexeddb',
          available: true,
          vaultCount
        }

      case 'localstorage':
        // Estimate localStorage usage
        let used = 0
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith('vault_')) {
            const item = localStorage.getItem(key)
            if (item) {
              used += key.length + item.length
            }
          }
        }
        return {
          type: 'localstorage',
          available: true,
          used: used * 2, // Approximate bytes (UTF-16)
          quota: 5 * 1024 * 1024, // 5MB typical limit
          vaultCount
        }

      case 'memory':
        return {
          type: 'memory',
          available: true,
          vaultCount
        }
    }
  }
}
```

### 2.3 Node.js Storage Implementation

**File:** `packages/sdk/src/provider/storage/NodeStorage.ts`

```typescript
import {
  BaseVaultStorage,
  VaultData,
  VaultMetadata,
  VaultSummary,
  StorageInfo
} from './VaultStorage'

/**
 * Node.js filesystem-based storage implementation
 */
export class NodeStorage extends BaseVaultStorage {
  private fs: any
  private path: any
  private os: any
  private storageDir: string
  private metadataFile: string

  constructor(storageDir?: string) {
    super()
    // Storage directory defaults to ~/.vultisig/vaults/
    this.storageDir = storageDir || ''
  }

  protected async doInitialize(): Promise<void> {
    // Dynamic imports for Node.js modules
    this.fs = await import('fs/promises')
    this.path = await import('path')
    this.os = await import('os')

    // Set storage directory if not provided
    if (!this.storageDir) {
      this.storageDir = this.path.join(
        this.os.homedir(),
        '.vultisig',
        'provider',
        'vaults'
      )
    }

    this.metadataFile = this.path.join(this.storageDir, 'metadata.json')

    // Create storage directory if it doesn't exist
    await this.fs.mkdir(this.storageDir, { recursive: true })

    // Initialize metadata file if it doesn't exist
    try {
      await this.fs.access(this.metadataFile)
    } catch {
      await this.saveAllMetadata({})
    }
  }

  async save(vaultId: string, data: VaultData): Promise<void> {
    await this.initialize()

    // Add checksum for data integrity
    data.checksum = await this.generateChecksum(data.vaultContainer)

    const vaultFile = this.path.join(this.storageDir, `${vaultId}.vult`)
    const tempFile = `${vaultFile}.tmp`

    // Write to temp file first (atomic write pattern)
    await this.fs.writeFile(
      tempFile,
      JSON.stringify(data, null, 2),
      'utf-8'
    )

    // Rename temp file to final file (atomic on most filesystems)
    await this.fs.rename(tempFile, vaultFile)
  }

  async load(vaultId: string): Promise<VaultData> {
    await this.initialize()

    const vaultFile = this.path.join(this.storageDir, `${vaultId}.vult`)

    try {
      const content = await this.fs.readFile(vaultFile, 'utf-8')
      const data = JSON.parse(content) as VaultData

      // Verify checksum if present
      if (data.checksum) {
        const valid = await this.verifyChecksum(data.vaultContainer, data.checksum)
        if (!valid) {
          throw new Error(`Vault ${vaultId} data integrity check failed`)
        }
      }

      return data
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Vault ${vaultId} not found`)
      }
      throw error
    }
  }

  async list(): Promise<VaultSummary[]> {
    await this.initialize()

    const metadata = await this.loadAllMetadata()

    // Filter out metadata for vaults that no longer exist
    const summaries: VaultSummary[] = []

    for (const [id, meta] of Object.entries(metadata)) {
      if (await this.exists(id)) {
        summaries.push({
          id: meta.id,
          name: meta.name,
          createdAt: meta.createdAt,
          lastAccessed: meta.lastAccessed,
          chains: meta.chains
        })
      }
    }

    // Sort by last accessed (most recent first)
    summaries.sort((a, b) => b.lastAccessed - a.lastAccessed)

    return summaries
  }

  async delete(vaultId: string): Promise<void> {
    await this.initialize()

    const vaultFile = this.path.join(this.storageDir, `${vaultId}.vult`)

    try {
      // Delete vault file
      await this.fs.unlink(vaultFile)

      // Remove from metadata
      const metadata = await this.loadAllMetadata()
      delete metadata[vaultId]
      await this.saveAllMetadata(metadata)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  async exists(vaultId: string): Promise<boolean> {
    await this.initialize()

    const vaultFile = this.path.join(this.storageDir, `${vaultId}.vult`)

    try {
      await this.fs.access(vaultFile)
      return true
    } catch {
      return false
    }
  }

  async saveMetadata(vaultId: string, metadata: VaultMetadata): Promise<void> {
    await this.initialize()

    const allMetadata = await this.loadAllMetadata()
    allMetadata[vaultId] = metadata
    await this.saveAllMetadata(allMetadata)
  }

  async loadMetadata(vaultId: string): Promise<VaultMetadata | null> {
    await this.initialize()

    const allMetadata = await this.loadAllMetadata()
    return allMetadata[vaultId] || null
  }

  async clear(): Promise<void> {
    await this.initialize()

    // Get all vault files
    const files = await this.fs.readdir(this.storageDir)

    // Delete all .vult files
    await Promise.all(
      files
        .filter((f: string) => f.endsWith('.vult'))
        .map((f: string) => this.fs.unlink(this.path.join(this.storageDir, f)))
    )

    // Clear metadata
    await this.saveAllMetadata({})
  }

  async getStorageInfo(): Promise<StorageInfo> {
    await this.initialize()

    const vaults = await this.list()

    // Calculate total storage used
    let totalUsed = 0
    const files = await this.fs.readdir(this.storageDir)

    for (const file of files) {
      if (file.endsWith('.vult') || file === 'metadata.json') {
        const filePath = this.path.join(this.storageDir, file)
        const stats = await this.fs.stat(filePath)
        totalUsed += stats.size
      }
    }

    return {
      type: 'filesystem',
      available: true,
      used: totalUsed,
      vaultCount: vaults.length
    }
  }

  /**
   * Load all metadata from the metadata file
   */
  private async loadAllMetadata(): Promise<Record<string, VaultMetadata>> {
    try {
      const content = await this.fs.readFile(this.metadataFile, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * Save all metadata to the metadata file
   */
  private async saveAllMetadata(metadata: Record<string, VaultMetadata>): Promise<void> {
    const tempFile = `${this.metadataFile}.tmp`

    // Write to temp file first
    await this.fs.writeFile(
      tempFile,
      JSON.stringify(metadata, null, 2),
      'utf-8'
    )

    // Atomic rename
    await this.fs.rename(tempFile, this.metadataFile)
  }

  /**
   * Create a backup of a vault
   */
  async backupVault(vaultId: string): Promise<string> {
    await this.initialize()

    const vaultFile = this.path.join(this.storageDir, `${vaultId}.vult`)
    const backupDir = this.path.join(this.storageDir, 'backups')

    // Create backup directory
    await this.fs.mkdir(backupDir, { recursive: true })

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = this.path.join(
      backupDir,
      `${vaultId}_backup_${timestamp}.vult`
    )

    // Copy vault file to backup
    await this.fs.copyFile(vaultFile, backupFile)

    return backupFile
  }

  /**
   * Restore a vault from backup
   */
  async restoreVault(backupPath: string, vaultId?: string): Promise<string> {
    await this.initialize()

    // Read backup file
    const backupContent = await this.fs.readFile(backupPath, 'utf-8')
    const backupData = JSON.parse(backupContent) as VaultData

    // Generate vault ID if not provided
    if (!vaultId) {
      vaultId = `restored_${Date.now()}`
    }

    // Save as new vault
    await this.save(vaultId, backupData)

    return vaultId
  }
}
```

---

## Phase 3: Provider Implementations

### 3.1 Base Provider Class

**File:** `packages/sdk/src/provider/BaseProvider.ts`

```typescript
import {
  VultisigProvider,
  ConnectionOptions,
  SignTransactionParams,
  SignedTransaction,
  SendTransactionParams,
  TransactionHash,
  SignMessageParams,
  SignTypedDataParams,
  GetBalanceParams,
  Balance,
  VaultSummary,
  CreateVaultOptions,
  ProviderError,
  ProviderErrorCode
} from './types'
import { UniversalEventEmitter } from './events/EventEmitter'
import { VaultStorage } from './storage/VaultStorage'
import { Vultisig } from '../VultisigSDK'
import { Vault } from '../vault/Vault'

/**
 * Base provider implementation with common functionality
 */
export abstract class BaseProvider extends UniversalEventEmitter implements VultisigProvider {
  protected sdk: Vultisig
  protected storage: VaultStorage
  protected activeVault: Vault | null = null
  protected connected: boolean = false
  protected activeChain: string = 'Bitcoin'
  protected password?: string

  constructor(storage: VaultStorage, sdkConfig?: any) {
    super()
    this.storage = storage
    this.sdk = new Vultisig(sdkConfig)
  }

  // ============================================
  // Connection Management
  // ============================================

  async connect(options?: ConnectionOptions): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      // Initialize storage and SDK
      await this.storage.initialize()
      await this.sdk.initialize()

      // Store password if provided
      if (options?.password) {
        this.password = options.password
      }

      // Implementation-specific connection
      await this.doConnect(options)

      this.connected = true
      this.emit('connect')
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Implementation-specific connection logic
   */
  protected abstract doConnect(options?: ConnectionOptions): Promise<void>

  async disconnect(): Promise<void> {
    this.activeVault = null
    this.connected = false
    this.password = undefined
    this.emit('disconnect')
  }

  isConnected(): boolean {
    return this.connected
  }

  // ============================================
  // Account Management
  // ============================================

  async getAccounts(chain?: string): Promise<string[]> {
    this.ensureConnected()

    if (!this.activeVault) {
      return []
    }

    if (chain) {
      try {
        const address = await this.activeVault.address(chain)
        return [address]
      } catch {
        return []
      }
    }

    // Get all addresses
    const addresses = await this.activeVault.addresses()
    return Object.values(addresses)
  }

  async getActiveAccount(chain: string): Promise<string | null> {
    this.ensureConnected()

    if (!this.activeVault) {
      return null
    }

    try {
      return await this.activeVault.address(chain)
    } catch {
      return null
    }
  }

  // ============================================
  // Chain Management
  // ============================================

  getSupportedChains(): string[] {
    this.ensureConnected()
    return this.activeVault?.chains || []
  }

  async setActiveChain(chain: string): Promise<void> {
    this.ensureConnected()

    const supported = this.getSupportedChains()
    if (!supported.includes(chain)) {
      throw new ProviderError(
        ProviderErrorCode.UNSUPPORTED_METHOD,
        `Chain ${chain} is not supported by this vault`
      )
    }

    const previousChain = this.activeChain
    this.activeChain = chain

    if (previousChain !== chain) {
      this.emit('chainChanged', chain)
    }
  }

  getActiveChain(): string {
    return this.activeChain
  }

  // ============================================
  // Transaction Operations
  // ============================================

  async signTransaction(params: SignTransactionParams): Promise<SignedTransaction> {
    this.ensureConnected()
    this.ensureVault()

    try {
      // Sign using vault
      const signature = await this.activeVault!.sign(
        params.signingMode || 'fast',
        params.transaction,
        params.password || this.password
      )

      return {
        signature: signature.signature,
        signedTransaction: signature.signature,
        transactionHash: undefined
      }
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to sign transaction: ${error.message}`,
        error
      )
    }
  }

  async sendTransaction(params: SendTransactionParams): Promise<TransactionHash> {
    // Sign the transaction
    const signed = await this.signTransaction(params)

    // TODO: Implement broadcasting
    // For now, return the signature as the transaction hash
    console.warn('Transaction broadcasting not implemented yet')
    return signed.signature
  }

  // ============================================
  // Message Signing
  // ============================================

  async signMessage(params: SignMessageParams): Promise<string> {
    this.ensureConnected()
    this.ensureVault()

    try {
      // Hash the message
      const messageHash = await this.hashMessage(params.message)

      // Sign the hash
      const signature = await this.activeVault!.sign(
        'fast',
        {
          message: messageHash,
          chain: params.chain
        },
        this.password
      )

      return signature.signature
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to sign message: ${error.message}`,
        error
      )
    }
  }

  async signTypedData(params: SignTypedDataParams): Promise<string> {
    // TODO: Implement EIP-712 typed data signing
    throw new ProviderError(
      ProviderErrorCode.UNSUPPORTED_METHOD,
      'signTypedData is not implemented yet'
    )
  }

  // ============================================
  // Balance Queries
  // ============================================

  async getBalance(params: GetBalanceParams): Promise<Balance> {
    this.ensureConnected()
    this.ensureVault()

    try {
      return await this.activeVault!.balance(params.chain, params.tokenId)
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to get balance: ${error.message}`,
        error
      )
    }
  }

  async getBalances(chains?: string[]): Promise<Record<string, Balance>> {
    this.ensureConnected()
    this.ensureVault()

    try {
      return await this.activeVault!.balances(chains)
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to get balances: ${error.message}`,
        error
      )
    }
  }

  // ============================================
  // Vault Management
  // ============================================

  hasVaultManagement(): boolean {
    return true
  }

  async loadVault(vaultId: string, password?: string): Promise<void> {
    await this.initialize()

    try {
      // Load vault data from storage
      const vaultData = await this.storage.load(vaultId)

      // Create File object for SDK
      const file = new File(
        [vaultData.vaultContainer],
        `${vaultId}.vult`,
        { type: 'application/octet-stream' }
      )

      // Import vault to SDK
      const vault = await this.sdk.addVault(file, password || this.password)

      // Set as active vault
      this.activeVault = vault

      // Update metadata
      const metadata = await this.storage.loadMetadata(vaultId)
      if (metadata) {
        metadata.lastAccessed = Date.now()
        await this.storage.saveMetadata(vaultId, metadata)
      }

      // Emit events
      const accounts = await this.getAccounts()
      this.emit('accountsChanged', accounts)
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to load vault: ${error.message}`,
        error
      )
    }
  }

  async listVaults(): Promise<VaultSummary[]> {
    await this.initialize()
    return this.storage.list()
  }

  async createVault(options: CreateVaultOptions): Promise<string> {
    await this.initialize()

    try {
      // Create vault using SDK
      const vault = await this.sdk.createFastVault({
        email: options.email,
        password: options.password,
        chains: options.chains
      })

      // Generate vault ID
      const vaultId = vault.id || crypto.randomUUID()

      // Export vault data
      const vaultContainer = await vault.export(options.password)

      // Save to storage
      await this.storage.save(vaultId, {
        vaultContainer,
        version: 1,
        timestamp: Date.now()
      })

      // Save metadata
      await this.storage.saveMetadata(vaultId, {
        id: vaultId,
        name: options.name,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lastModified: Date.now(),
        chains: options.chains
      })

      // Set as active vault
      this.activeVault = vault

      // Emit events
      const accounts = await this.getAccounts()
      this.emit('accountsChanged', accounts)

      return vaultId
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to create vault: ${error.message}`,
        error
      )
    }
  }

  async deleteVault(vaultId: string): Promise<void> {
    await this.initialize()

    await this.storage.delete(vaultId)

    // If deleted vault was active, clear it
    if (this.activeVault?.id === vaultId) {
      this.activeVault = null
      this.emit('accountsChanged', [])
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  protected async initialize(): Promise<void> {
    if (!this.storage) {
      throw new Error('Storage not initialized')
    }
    await this.storage.initialize()
  }

  protected ensureConnected(): void {
    if (!this.connected) {
      throw new ProviderError(
        ProviderErrorCode.DISCONNECTED,
        'Provider not connected. Call connect() first.'
      )
    }
  }

  protected ensureVault(): void {
    if (!this.activeVault) {
      throw new ProviderError(
        ProviderErrorCode.UNAUTHORIZED,
        'No active vault. Load a vault first.'
      )
    }
  }

  protected async hashMessage(message: string): Promise<string> {
    // Use Web Crypto API if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder()
      const data = encoder.encode(message)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }

    // Fallback for Node.js
    if (typeof require !== 'undefined') {
      const crypto = require('crypto')
      return crypto.createHash('sha256').update(message).digest('hex')
    }

    throw new Error('No crypto implementation available')
  }
}
```

### 3.2 Browser Provider

**File:** `packages/sdk/src/provider/BrowserProvider.ts`

```typescript
import { BaseProvider } from './BaseProvider'
import { BrowserStorage } from './storage/BrowserStorage'
import {
  ConnectionOptions,
  SignTransactionParams,
  SignedTransaction,
  ProviderError,
  ProviderErrorCode
} from './types'

/**
 * Browser-specific provider implementation
 * Supports both extension mode and embedded vault mode
 */
export class BrowserProvider extends BaseProvider {
  private extensionAvailable: boolean = false
  private extensionConnected: boolean = false

  constructor(sdkConfig?: any) {
    super(new BrowserStorage(), sdkConfig)
  }

  protected async doConnect(options?: ConnectionOptions): Promise<void> {
    // Check for Vultisig extension
    this.extensionAvailable = await this.checkExtension()

    if (this.extensionAvailable && !options?.forceEmbedded) {
      // Try to connect to extension
      try {
        await this.connectToExtension(options)
        this.extensionConnected = true
        return
      } catch (error) {
        console.warn('Failed to connect to extension, falling back to embedded mode', error)
      }
    }

    // Use embedded vault mode
    await this.connectEmbedded(options)
  }

  /**
   * Check if Vultisig extension is installed
   */
  private async checkExtension(): Promise<boolean> {
    // Check for window.vultisig (injected by extension)
    if (typeof window !== 'undefined' && (window as any).vultisig) {
      return true
    }

    // Try to ping extension via postMessage
    return this.pingExtension()
  }

  /**
   * Ping extension to check if it's available
   */
  private async pingExtension(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler)
        resolve(false)
      }, 1000)

      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'vultisig_pong') {
          clearTimeout(timeout)
          window.removeEventListener('message', handler)
          resolve(true)
        }
      }

      window.addEventListener('message', handler)
      window.postMessage({ type: 'vultisig_ping' }, '*')
    })
  }

  /**
   * Connect to Vultisig extension
   */
  private async connectToExtension(options?: ConnectionOptions): Promise<void> {
    const response = await this.sendToExtension({
      method: 'connect',
      params: {
        chains: options?.chains,
        origin: window.location.origin
      }
    })

    if (response.error) {
      throw new ProviderError(
        response.error.code || ProviderErrorCode.INTERNAL_ERROR,
        response.error.message
      )
    }

    // Extension connected - no local vault needed
    // The extension handles all vault operations
  }

  /**
   * Connect using embedded vault (no extension)
   */
  private async connectEmbedded(options?: ConnectionOptions): Promise<void> {
    // Try to load vault
    if (options?.vaultId) {
      await this.loadVault(options.vaultId, options.password)
    } else if (options?.autoConnect) {
      // Auto-load most recent vault
      const vaults = await this.listVaults()

      if (vaults.length > 0) {
        const mostRecent = vaults.sort((a, b) => b.lastAccessed - a.lastAccessed)[0]

        try {
          await this.loadVault(mostRecent.id, options?.password)
        } catch (error) {
          console.warn('Failed to auto-load vault:', error)
        }
      }
    }
    // If no vault loaded, provider is connected but no accounts available
  }

  /**
   * Send message to extension
   */
  private async sendToExtension(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler)
        reject(new Error('Extension request timeout'))
      }, 30000)

      const handler = (event: MessageEvent) => {
        if (event.data?.id === id && event.data?.source === 'vultisig-extension') {
          clearTimeout(timeout)
          window.removeEventListener('message', handler)
          resolve(event.data)
        }
      }

      window.addEventListener('message', handler)

      window.postMessage({
        ...message,
        id,
        source: 'vultisig-provider'
      }, '*')
    })
  }

  // ============================================
  // Override methods for extension mode
  // ============================================

  async getAccounts(chain?: string): Promise<string[]> {
    if (this.extensionConnected) {
      try {
        const response = await this.sendToExtension({
          method: 'getAccounts',
          params: { chain }
        })

        if (response.error) {
          throw new Error(response.error.message)
        }

        return response.result || []
      } catch (error) {
        console.warn('Extension getAccounts failed:', error)
        // Fall back to embedded mode
      }
    }

    return super.getAccounts(chain)
  }

  async signTransaction(params: SignTransactionParams): Promise<SignedTransaction> {
    if (this.extensionConnected) {
      try {
        const response = await this.sendToExtension({
          method: 'signTransaction',
          params
        })

        if (response.error) {
          throw new Error(response.error.message)
        }

        return response.result
      } catch (error) {
        console.warn('Extension signTransaction failed:', error)
        // Fall back to embedded mode
      }
    }

    return super.signTransaction(params)
  }

  async signMessage(params: SignMessageParams): Promise<string> {
    if (this.extensionConnected) {
      try {
        const response = await this.sendToExtension({
          method: 'signMessage',
          params
        })

        if (response.error) {
          throw new Error(response.error.message)
        }

        return response.result
      } catch (error) {
        console.warn('Extension signMessage failed:', error)
        // Fall back to embedded mode
      }
    }

    return super.signMessage(params)
  }

  // ============================================
  // Browser-specific methods
  // ============================================

  /**
   * Request permissions from extension
   */
  async requestPermissions(permissions: string[]): Promise<boolean> {
    if (this.extensionConnected) {
      const response = await this.sendToExtension({
        method: 'requestPermissions',
        params: { permissions }
      })

      return response.result === true
    }

    // In embedded mode, always grant permissions
    return true
  }

  /**
   * Get extension info
   */
  async getExtensionInfo(): Promise<any> {
    if (this.extensionConnected) {
      const response = await this.sendToExtension({
        method: 'getInfo'
      })

      return response.result
    }

    return null
  }

  /**
   * Check if using extension or embedded mode
   */
  isUsingExtension(): boolean {
    return this.extensionConnected
  }
}
```

### 3.3 Node.js Provider

**File:** `packages/sdk/src/provider/NodeProvider.ts`

```typescript
import { BaseProvider } from './BaseProvider'
import { NodeStorage } from './storage/NodeStorage'
import {
  ConnectionOptions,
  CreateVaultOptions,
  ProviderError,
  ProviderErrorCode
} from './types'

/**
 * Node.js-specific provider implementation
 * Supports filesystem-based vault storage and direct SDK usage
 */
export class NodeProvider extends BaseProvider {
  private fs: any
  private path: any

  constructor(sdkConfig?: any, storageDir?: string) {
    super(new NodeStorage(storageDir), sdkConfig)
  }

  protected async doConnect(options?: ConnectionOptions): Promise<void> {
    // Load Node.js modules
    this.fs = await import('fs/promises')
    this.path = await import('path')

    // Load vault based on options
    if (options?.vaultPath) {
      // Load from specific file path
      await this.loadVaultFromPath(options.vaultPath, options.password)
    } else if (options?.vaultId) {
      // Load from storage by ID
      await this.loadVault(options.vaultId, options.password)
    } else if (options?.autoConnect) {
      // Auto-load most recent vault
      await this.autoLoadVault(options.password)
    }
    // If no vault loaded, provider is connected but no accounts available
  }

  /**
   * Load vault from file path
   */
  private async loadVaultFromPath(vaultPath: string, password?: string): Promise<void> {
    try {
      // Read vault file
      const absolutePath = this.path.resolve(vaultPath)
      const vaultContent = await this.fs.readFile(absolutePath, 'utf-8')

      // Create File object for SDK
      const file = new File(
        [vaultContent],
        this.path.basename(vaultPath),
        { type: 'application/octet-stream' }
      )

      // Import to SDK
      const vault = await this.sdk.addVault(file, password || this.password)
      this.activeVault = vault

      // Optionally save to storage for future use
      const vaultId = vault.id || crypto.randomUUID()

      await this.storage.save(vaultId, {
        vaultContainer: vaultContent,
        version: 1,
        timestamp: Date.now()
      })

      await this.storage.saveMetadata(vaultId, {
        id: vaultId,
        name: vault.name || this.path.basename(vaultPath, '.vult'),
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lastModified: Date.now(),
        chains: vault.chains
      })

      // Emit events
      const accounts = await this.getAccounts()
      this.emit('accountsChanged', accounts)
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to load vault from path: ${error.message}`,
        error
      )
    }
  }

  /**
   * Auto-load most recent vault
   */
  private async autoLoadVault(password?: string): Promise<void> {
    const vaults = await this.listVaults()

    if (vaults.length === 0) {
      // No vaults available - this is OK, provider is connected
      return
    }

    // Load most recently accessed vault
    const mostRecent = vaults.sort((a, b) => b.lastAccessed - a.lastAccessed)[0]

    try {
      await this.loadVault(mostRecent.id, password || this.password)
    } catch (error) {
      console.warn(`Failed to auto-load vault ${mostRecent.id}:`, error)
      // Don't throw - provider is still connected
    }
  }

  // ============================================
  // Node.js specific vault management
  // ============================================

  /**
   * Export vault to file
   */
  async exportVault(vaultId: string, outputPath: string): Promise<void> {
    await this.initialize()

    try {
      const vaultData = await this.storage.load(vaultId)
      const absolutePath = this.path.resolve(outputPath)

      // Ensure directory exists
      const dir = this.path.dirname(absolutePath)
      await this.fs.mkdir(dir, { recursive: true })

      // Write vault file
      await this.fs.writeFile(absolutePath, vaultData.vaultContainer, 'utf-8')
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to export vault: ${error.message}`,
        error
      )
    }
  }

  /**
   * Import vault from file
   */
  async importVault(inputPath: string, password?: string): Promise<string> {
    await this.initialize()

    try {
      const absolutePath = this.path.resolve(inputPath)
      const vaultContent = await this.fs.readFile(absolutePath, 'utf-8')

      // Create File object for SDK
      const file = new File(
        [vaultContent],
        this.path.basename(inputPath),
        { type: 'application/octet-stream' }
      )

      // Import to SDK
      const vault = await this.sdk.addVault(file, password || this.password)

      // Generate vault ID
      const vaultId = vault.id || crypto.randomUUID()

      // Save to storage
      await this.storage.save(vaultId, {
        vaultContainer: vaultContent,
        version: 1,
        timestamp: Date.now()
      })

      await this.storage.saveMetadata(vaultId, {
        id: vaultId,
        name: vault.name || this.path.basename(inputPath, '.vult'),
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lastModified: Date.now(),
        chains: vault.chains
      })

      return vaultId
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to import vault: ${error.message}`,
        error
      )
    }
  }

  /**
   * Create vault with additional options
   */
  async createVault(options: CreateVaultOptions): Promise<string> {
    await this.initialize()

    try {
      // Create vault using SDK
      const vault = options.mode === 'secure'
        ? await this.sdk.createSecureVault({
            email: options.email,
            password: options.password,
            chains: options.chains
          })
        : await this.sdk.createFastVault({
            email: options.email,
            password: options.password,
            chains: options.chains
          })

      // Generate vault ID
      const vaultId = vault.id || crypto.randomUUID()

      // Export vault data
      const vaultContainer = await vault.export(options.password)

      // Save to storage
      await this.storage.save(vaultId, {
        vaultContainer,
        version: 1,
        timestamp: Date.now()
      })

      await this.storage.saveMetadata(vaultId, {
        id: vaultId,
        name: options.name,
        description: options.description,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lastModified: Date.now(),
        chains: options.chains,
        tags: options.tags
      })

      // Set as active vault
      this.activeVault = vault

      // Emit events
      const accounts = await this.getAccounts()
      this.emit('accountsChanged', accounts)

      return vaultId
    } catch (error: any) {
      throw new ProviderError(
        ProviderErrorCode.INTERNAL_ERROR,
        `Failed to create vault: ${error.message}`,
        error
      )
    }
  }

  /**
   * Backup vault
   */
  async backupVault(vaultId: string): Promise<string> {
    if (this.storage instanceof NodeStorage) {
      return this.storage.backupVault(vaultId)
    }
    throw new Error('Backup not supported with current storage')
  }

  /**
   * Restore vault from backup
   */
  async restoreVault(backupPath: string, vaultId?: string): Promise<string> {
    if (this.storage instanceof NodeStorage) {
      return this.storage.restoreVault(backupPath, vaultId)
    }
    throw new Error('Restore not supported with current storage')
  }

  /**
   * Get storage directory path
   */
  getStorageDirectory(): string | undefined {
    if (this.storage instanceof NodeStorage) {
      return (this.storage as any).storageDir
    }
    return undefined
  }
}
```

---

## Phase 4: Provider Factory & Integration

### 4.1 Provider Factory

**File:** `packages/sdk/src/provider/factory.ts`

```typescript
import { VultisigProvider, ConnectionOptions } from './types'
import { detectEnvironment } from './environment'

export interface CreateProviderOptions extends ConnectionOptions {
  environment?: 'browser' | 'node' | 'auto'
  sdkConfig?: any
  storageDir?: string           // Node.js only
  forceEmbedded?: boolean       // Browser only - skip extension
}

/**
 * Create a provider with automatic environment detection
 */
export async function createProvider(
  options?: CreateProviderOptions
): Promise<VultisigProvider> {
  // Determine environment
  const env = options?.environment === 'auto' || !options?.environment
    ? detectEnvironment()
    : options.environment

  if (env === 'unknown') {
    throw new Error(
      'Unable to detect environment. Please specify environment explicitly.'
    )
  }

  let provider: VultisigProvider

  switch (env) {
    case 'browser':
      const { BrowserProvider } = await import('./BrowserProvider')
      provider = new BrowserProvider(options?.sdkConfig)
      break

    case 'node':
      const { NodeProvider } = await import('./NodeProvider')
      provider = new NodeProvider(options?.sdkConfig, options?.storageDir)
      break

    default:
      throw new Error(`Unsupported environment: ${env}`)
  }

  // Auto-connect if requested
  if (options?.autoConnect) {
    await provider.connect(options)
  }

  return provider
}

/**
 * Create a browser provider explicitly
 */
export async function createBrowserProvider(
  options?: CreateProviderOptions
): Promise<VultisigProvider> {
  const { BrowserProvider } = await import('./BrowserProvider')
  const provider = new BrowserProvider(options?.sdkConfig)

  if (options?.autoConnect) {
    await provider.connect(options)
  }

  return provider
}

/**
 * Create a Node.js provider explicitly
 */
export async function createNodeProvider(
  options?: CreateProviderOptions
): Promise<VultisigProvider> {
  const { NodeProvider } = await import('./NodeProvider')
  const provider = new NodeProvider(options?.sdkConfig, options?.storageDir)

  if (options?.autoConnect) {
    await provider.connect(options)
  }

  return provider
}

/**
 * Check if environment supports providers
 */
export function isProviderSupported(): boolean {
  const env = detectEnvironment()
  return env === 'browser' || env === 'node'
}

/**
 * Get recommended provider for current environment
 */
export function getRecommendedProvider(): 'browser' | 'node' | null {
  const env = detectEnvironment()

  switch (env) {
    case 'browser':
      return 'browser'
    case 'node':
      return 'node'
    default:
      return null
  }
}
```

### 4.2 Main SDK Export Updates

**File:** `packages/sdk/src/index.ts`

```typescript
// ============================================
// Existing SDK exports
// ============================================

export { Vultisig } from './VultisigSDK'
export { Vault } from './vault/Vault'
export { VaultManager } from './VaultManager'
export { AddressBook } from './AddressBook'

// ... other existing exports

// ============================================
// Provider exports
// ============================================

// Types
export type {
  // Core interface
  VultisigProvider,

  // Connection
  ConnectionOptions,

  // Transactions
  SignTransactionParams,
  SignedTransaction,
  SendTransactionParams,
  TransactionHash,

  // Messages
  SignMessageParams,
  SignTypedDataParams,

  // Balance
  GetBalanceParams,
  Balance,

  // Vault
  VaultSummary,
  CreateVaultOptions,

  // Events
  ProviderEvent,
  ProviderEventMap,
  ProviderMessage,

  // Errors
  ProviderError
} from './provider/types'

// Factory functions
export {
  createProvider,
  createBrowserProvider,
  createNodeProvider,
  isProviderSupported,
  getRecommendedProvider,
  type CreateProviderOptions
} from './provider/factory'

// Provider implementations (for advanced usage)
export { BaseProvider } from './provider/BaseProvider'
export { BrowserProvider } from './provider/BrowserProvider'
export { NodeProvider } from './provider/NodeProvider'

// Storage interfaces and implementations
export type {
  VaultStorage,
  VaultData,
  VaultMetadata,
  StorageInfo
} from './provider/storage/VaultStorage'

export { BrowserStorage } from './provider/storage/BrowserStorage'
export { NodeStorage } from './provider/storage/NodeStorage'

// Environment utilities
export {
  detectEnvironment,
  EnvironmentFeatures,
  getGlobalObject,
  type RuntimeEnvironment
} from './provider/environment'

// Event emitter
export { UniversalEventEmitter } from './provider/events/EventEmitter'

// Error codes
export { ProviderErrorCode } from './provider/types'
```

---

## Phase 5: Testing & Documentation

### 5.1 Unit Tests

**File:** `packages/sdk/src/provider/__tests__/BrowserProvider.test.ts`

```typescript
import { BrowserProvider } from '../BrowserProvider'
import { BrowserStorage } from '../storage/BrowserStorage'

describe('BrowserProvider', () => {
  let provider: BrowserProvider

  beforeEach(() => {
    provider = new BrowserProvider()

    // Mock window object
    global.window = {
      location: { origin: 'http://localhost:3000' },
      postMessage: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      crypto: {
        randomUUID: () => 'test-uuid'
      }
    } as any
  })

  afterEach(() => {
    delete global.window
  })

  describe('Extension Detection', () => {
    it('should detect extension when window.vultisig exists', async () => {
      global.window.vultisig = {}

      await provider.connect()

      expect(provider.isConnected()).toBe(true)
      expect(provider.isUsingExtension()).toBe(true)
    })

    it('should fallback to embedded mode when no extension', async () => {
      await provider.connect()

      expect(provider.isConnected()).toBe(true)
      expect(provider.isUsingExtension()).toBe(false)
    })

    it('should force embedded mode when specified', async () => {
      global.window.vultisig = {}

      await provider.connect({ forceEmbedded: true })

      expect(provider.isConnected()).toBe(true)
      expect(provider.isUsingExtension()).toBe(false)
    })
  })

  describe('Vault Management', () => {
    it('should load vault by ID', async () => {
      const mockStorage = new BrowserStorage()
      jest.spyOn(mockStorage, 'load').mockResolvedValue({
        vaultContainer: 'encrypted-data',
        version: 1,
        timestamp: Date.now()
      })

      // Replace storage
      (provider as any).storage = mockStorage

      await provider.connect()
      await provider.loadVault('test-vault-id', 'password')

      expect(mockStorage.load).toHaveBeenCalledWith('test-vault-id')
    })

    it('should list vaults', async () => {
      const mockStorage = new BrowserStorage()
      jest.spyOn(mockStorage, 'list').mockResolvedValue([
        {
          id: 'vault1',
          name: 'Test Vault 1',
          createdAt: Date.now(),
          lastAccessed: Date.now()
        }
      ])

      (provider as any).storage = mockStorage

      await provider.connect()
      const vaults = await provider.listVaults()

      expect(vaults).toHaveLength(1)
      expect(vaults[0].name).toBe('Test Vault 1')
    })
  })

  describe('Event Handling', () => {
    it('should emit connect event', async () => {
      const connectHandler = jest.fn()
      provider.on('connect', connectHandler)

      await provider.connect()

      expect(connectHandler).toHaveBeenCalled()
    })

    it('should emit disconnect event', async () => {
      const disconnectHandler = jest.fn()
      provider.on('disconnect', disconnectHandler)

      await provider.connect()
      await provider.disconnect()

      expect(disconnectHandler).toHaveBeenCalled()
    })

    it('should emit chainChanged event', async () => {
      const chainHandler = jest.fn()
      provider.on('chainChanged', chainHandler)

      await provider.connect()

      // Mock active vault
      (provider as any).activeVault = {
        chains: ['Bitcoin', 'Ethereum']
      }

      await provider.setActiveChain('Ethereum')

      expect(chainHandler).toHaveBeenCalledWith('Ethereum')
    })
  })
})
```

**File:** `packages/sdk/src/provider/__tests__/NodeProvider.test.ts`

```typescript
import { NodeProvider } from '../NodeProvider'
import { NodeStorage } from '../storage/NodeStorage'

describe('NodeProvider', () => {
  let provider: NodeProvider

  beforeEach(() => {
    provider = new NodeProvider()
  })

  describe('Connection', () => {
    it('should connect without vault', async () => {
      await provider.connect()

      expect(provider.isConnected()).toBe(true)
      expect(await provider.getAccounts()).toEqual([])
    })

    it('should auto-load vault', async () => {
      const mockStorage = new NodeStorage()
      jest.spyOn(mockStorage, 'list').mockResolvedValue([
        {
          id: 'vault1',
          name: 'Test Vault',
          createdAt: Date.now() - 86400000,
          lastAccessed: Date.now()
        }
      ])

      jest.spyOn(mockStorage, 'load').mockResolvedValue({
        vaultContainer: 'encrypted-data',
        version: 1,
        timestamp: Date.now()
      })

      (provider as any).storage = mockStorage

      await provider.connect({ autoConnect: true })

      expect(mockStorage.list).toHaveBeenCalled()
      expect(mockStorage.load).toHaveBeenCalledWith('vault1')
    })
  })

  describe('Vault Operations', () => {
    it('should export vault to file', async () => {
      const mockFs = {
        writeFile: jest.fn(),
        mkdir: jest.fn()
      }

      const mockPath = {
        resolve: (p: string) => p,
        dirname: () => '/output'
      }

      (provider as any).fs = mockFs
      (provider as any).path = mockPath

      const mockStorage = new NodeStorage()
      jest.spyOn(mockStorage, 'load').mockResolvedValue({
        vaultContainer: 'vault-data',
        version: 1,
        timestamp: Date.now()
      })

      (provider as any).storage = mockStorage

      await provider.connect()
      await provider.exportVault('vault1', '/output/vault.vult')

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/output/vault.vult',
        'vault-data',
        'utf-8'
      )
    })

    it('should import vault from file', async () => {
      const mockFs = {
        readFile: jest.fn().mockResolvedValue('vault-data')
      }

      const mockPath = {
        resolve: (p: string) => p,
        basename: () => 'vault.vult'
      }

      (provider as any).fs = mockFs
      (provider as any).path = mockPath

      await provider.connect()
      const vaultId = await provider.importVault('/input/vault.vult', 'password')

      expect(mockFs.readFile).toHaveBeenCalledWith('/input/vault.vult', 'utf-8')
      expect(vaultId).toBeDefined()
    })
  })
})
```

### 5.2 Integration Tests

**File:** `packages/sdk/src/provider/__tests__/integration.test.ts`

```typescript
import { createProvider } from '../factory'
import { detectEnvironment } from '../environment'

describe('Provider Integration', () => {
  it('should auto-detect environment', async () => {
    const provider = await createProvider({
      environment: 'auto'
    })

    expect(provider).toBeDefined()

    const env = detectEnvironment()
    if (env === 'node') {
      expect(provider.constructor.name).toBe('NodeProvider')
    } else if (env === 'browser') {
      expect(provider.constructor.name).toBe('BrowserProvider')
    }
  })

  it('should connect and disconnect', async () => {
    const provider = await createProvider()

    expect(provider.isConnected()).toBe(false)

    await provider.connect()
    expect(provider.isConnected()).toBe(true)

    await provider.disconnect()
    expect(provider.isConnected()).toBe(false)
  })

  it('should handle events', async () => {
    const provider = await createProvider()

    const events: string[] = []

    provider.on('connect', () => events.push('connect'))
    provider.on('disconnect', () => events.push('disconnect'))

    await provider.connect()
    await provider.disconnect()

    expect(events).toEqual(['connect', 'disconnect'])
  })
})
```

---

## Usage Examples

### Browser Usage

```typescript
import { createProvider } from '@vultisig/sdk'

async function main() {
  // Create provider with auto-detection
  const provider = await createProvider({
    environment: 'auto',
    autoConnect: true,
    chains: ['Bitcoin', 'Ethereum', 'Solana']
  })

  // Listen for events
  provider.on('connect', () => {
    console.log('Connected to Vultisig!')
  })

  provider.on('accountsChanged', (accounts) => {
    console.log('Accounts changed:', accounts)
  })

  // Get accounts
  const btcAccounts = await provider.getAccounts('Bitcoin')
  console.log('Bitcoin address:', btcAccounts[0])

  // Sign transaction
  const signed = await provider.signTransaction({
    chain: 'Bitcoin',
    transaction: {
      to: 'bc1q...',
      amount: '100000',
      fee: '1000'
    }
  })

  console.log('Signed transaction:', signed.signature)

  // Get balances
  const balances = await provider.getBalances(['Bitcoin', 'Ethereum'])
  console.log('Balances:', balances)
}

main().catch(console.error)
```

### Node.js Usage

```typescript
import { createNodeProvider } from '@vultisig/sdk'
import * as dotenv from 'dotenv'

dotenv.config()

async function main() {
  // Create Node.js provider
  const provider = await createNodeProvider({
    storageDir: './vaults',
    vaultPath: process.env.VAULT_PATH,
    password: process.env.VAULT_PASSWORD,
    autoConnect: true
  })

  // List available vaults
  const vaults = await provider.listVaults()
  console.log(`Found ${vaults.length} vaults:`)
  vaults.forEach(v => console.log(`  - ${v.name} (${v.id})`))

  // Create new vault
  if (vaults.length === 0) {
    const vaultId = await provider.createVault({
      name: 'My Vault',
      email: 'user@example.com',
      password: process.env.VAULT_PASSWORD!,
      chains: ['Bitcoin', 'Ethereum', 'Solana']
    })

    console.log('Created vault:', vaultId)
  }

  // Sign and send transaction
  const txHash = await provider.sendTransaction({
    chain: 'Ethereum',
    transaction: {
      to: '0x...',
      value: '1000000000000000000', // 1 ETH
      gasLimit: '21000'
    }
  })

  console.log('Transaction sent:', txHash)

  // Export vault
  await provider.exportVault(vaults[0].id, './backup.vult')
  console.log('Vault exported to backup.vult')
}

main().catch(console.error)
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react'
import { createProvider, VultisigProvider } from '@vultisig/sdk'

export function useVultisigProvider() {
  const [provider, setProvider] = useState<VultisigProvider | null>(null)
  const [connected, setConnected] = useState(false)
  const [accounts, setAccounts] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const p = await createProvider({
          environment: 'browser',
          autoConnect: true
        })

        // Set up event listeners
        p.on('connect', () => setConnected(true))
        p.on('disconnect', () => setConnected(false))
        p.on('accountsChanged', setAccounts)

        // Connect
        await p.connect()

        // Get initial accounts
        const accs = await p.getAccounts()
        setAccounts(accs)

        setProvider(p)
      } catch (error) {
        console.error('Failed to initialize provider:', error)
      } finally {
        setLoading(false)
      }
    }

    init()

    return () => {
      provider?.disconnect()
    }
  }, [])

  return {
    provider,
    connected,
    accounts,
    loading
  }
}

// Usage in component
function MyComponent() {
  const { provider, connected, accounts } = useVultisigProvider()

  if (!connected) {
    return <div>Please connect your wallet</div>
  }

  return (
    <div>
      <h2>Connected Accounts</h2>
      <ul>
        {accounts.map(acc => (
          <li key={acc}>{acc}</li>
        ))}
      </ul>
    </div>
  )
}
```

---

## Package Configuration

### Package.json Updates

```json
{
  "name": "@vultisig/sdk",
  "version": "1.0.0",
  "description": "Vultisig SDK with unified provider support",
  "main": "dist/index.js",
  "module": "dist/index.esm.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.esm.js",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "rollup -c",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/**/*.ts",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    // Existing dependencies...
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/jest": "^29.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "rollup": "^3.0.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "@rollup/plugin-node-resolve": "^15.0.0",
    "@rollup/plugin-commonjs": "^25.0.0"
  },
  "optionalDependencies": {
    "fs": "^0.0.1-security",
    "path": "^0.12.7",
    "os": "^0.1.2"
  },
  "browser": {
    "fs": false,
    "path": false,
    "os": false
  }
}
```

### Rollup Configuration Update

```javascript
// packages/sdk/rollup.config.js
import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'es',
      sourcemap: true
    },
    external: ['fs', 'path', 'os', 'crypto'],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      resolve({ preferBuiltins: true }),
      commonjs()
    ]
  },

  // CommonJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true
    },
    external: ['fs', 'path', 'os', 'crypto'],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      resolve({ preferBuiltins: true }),
      commonjs()
    ]
  },

  // UMD build (browser)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'VultisigSDK',
      sourcemap: true,
      globals: {
        'fs': 'null',
        'path': 'null',
        'os': 'null'
      }
    },
    external: ['fs', 'path', 'os'],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' }),
      resolve({
        preferBuiltins: false,
        browser: true
      }),
      commonjs()
    ]
  }
]
```

---

## Implementation Timeline

### Week 1: Core Infrastructure
- Day 1-2: Set up types, interfaces, and environment detection
- Day 3-4: Implement event emitter and base classes
- Day 5: Testing and refinement

### Week 2: Storage & Providers
- Day 1-2: Implement storage abstraction (Browser + Node.js)
- Day 3-4: Implement provider classes
- Day 5: Integration with existing SDK

### Week 3: Testing & Documentation
- Day 1-2: Write comprehensive tests
- Day 3-4: Create documentation and examples
- Day 5: Final testing and bug fixes

### Week 4: Polish & Release
- Day 1-2: Performance optimization
- Day 3-4: Additional examples and guides
- Day 5: Release preparation

---

## Success Criteria

✅ **Unified API** - Same interface works in browser and Node.js
✅ **Storage Abstraction** - Seamless handling of different storage mechanisms
✅ **Extension Support** - Automatic detection and fallback
✅ **Type Safety** - Full TypeScript support with strict types
✅ **Backward Compatible** - Existing SDK usage unaffected
✅ **Well Tested** - >80% test coverage
✅ **Documented** - Comprehensive API docs and examples
✅ **Performant** - Operations complete in <100ms

---

## Conclusion

This implementation guide provides a complete blueprint for building a unified provider library for the Vultisig SDK. The design emphasizes:

1. **Simplicity** - Clean, intuitive API
2. **Flexibility** - Works across environments
3. **Security** - No prompts in SDK, programmatic control
4. **Extensibility** - Easy to add new features
5. **Compatibility** - Works with existing SDK

Following this guide, developers can implement a robust provider system that brings the convenience of Web3 providers to Vultisig's multi-chain wallet functionality.