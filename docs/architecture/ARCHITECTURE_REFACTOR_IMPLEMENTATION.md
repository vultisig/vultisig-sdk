# Architecture Refactoring Implementation Guide

**Date:** 2025-10-28
**Status:** Implementation Guide
**Version:** 1.0

---

## Overview

This document provides comprehensive, step-by-step implementation details for the architecture refactoring. It includes complete code examples, folder structures, and enough detail to implement the changes based solely on this document.

**Goal:** Refactor internal architecture while keeping public API 100% unchanged.

---

## Table of Contents

1. [Folder Structure](#folder-structure)
2. [Phase 1: Create Strategy Pattern](#phase-1-create-strategy-pattern)
3. [Phase 2: Create Service Layer](#phase-2-create-service-layer)
4. [Phase 3: Integrate Services into Vault](#phase-3-integrate-services-into-vault)
5. [Phase 4: Enhance ChainManager](#phase-4-enhance-chainmanager)
6. [Phase 5: Clean Up Exports](#phase-5-clean-up-exports)
7. [Phase 6: Delete Redundant Code](#phase-6-delete-redundant-code)
8. [Testing Strategy](#testing-strategy)
9. [Implementation Checklist](#implementation-checklist)

---

## Folder Structure

### Before Refactoring

```
packages/sdk/src/
├── index.ts                          # 120+ exports
├── VultisigSDK.ts                    # 29 public methods
├── vault/
│   ├── Vault.ts                      # 24 public methods
│   ├── BalanceManagement.ts          # ⚠️ Delete this
│   ├── AddressBook.ts
│   ├── ChainManagement.ts
│   ├── VaultManagement.ts
│   └── balance/
│       └── blockchair/               # Disconnected
├── chains/
│   ├── ChainManager.ts               # Used by Vault
│   ├── AddressDeriver.ts             # Used by Vault
│   ├── evm/
│   │   ├── index.ts                  # 51 exports
│   │   ├── types.ts
│   │   ├── config.ts
│   │   ├── keysign.ts
│   │   ├── parsers/                  # 5 parser files
│   │   ├── gas/                      # 2 utility files
│   │   └── tokens/                   # 2 utility files
│   └── solana/
│       ├── index.ts                  # 12 exports
│       ├── types.ts
│       ├── config.ts
│       ├── keysign.ts
│       └── parsers/                  # 3 parser files
├── server/
├── wasm/
├── mpc/
└── crypto/
```

### After Refactoring

```
packages/sdk/src/
├── index.ts                          # 10-15 exports ✅
├── VultisigSDK.ts                    # 29 methods (unchanged)
├── vault/
│   ├── Vault.ts                      # 24 methods (unchanged, internals refactored)
│   ├── services/                     # ✅ NEW
│   │   ├── AddressService.ts         # Coordinates address derivation
│   │   ├── BalanceService.ts         # Coordinates balance fetching
│   │   ├── SigningService.ts         # Coordinates signing
│   │   └── CacheService.ts           # Centralized caching
│   ├── AddressBook.ts
│   ├── ChainManagement.ts
│   ├── VaultManagement.ts
│   └── balance/
│       └── blockchair/               # ✅ Integrated
├── chains/
│   ├── ChainManager.ts               # ✅ Enhanced with Blockchair
│   ├── AddressDeriver.ts             # Keep as-is
│   ├── strategies/                   # ✅ NEW
│   │   ├── ChainStrategy.ts          # Interface
│   │   └── ChainStrategyFactory.ts   # Factory
│   ├── evm/
│   │   ├── EvmStrategy.ts            # ✅ NEW - Single entry point
│   │   ├── index.ts                  # Only exports EvmStrategy
│   │   ├── types.ts
│   │   ├── config.ts                 # Internal
│   │   ├── keysign.ts                # Internal
│   │   ├── parsers/                  # Internal
│   │   ├── gas/                      # Internal
│   │   └── tokens/                   # Internal
│   └── solana/
│       ├── SolanaStrategy.ts         # ✅ NEW - Single entry point
│       ├── index.ts                  # Only exports SolanaStrategy
│       ├── types.ts
│       ├── config.ts                 # Internal
│       ├── keysign.ts                # Internal
│       └── parsers/                  # Internal
├── server/
├── wasm/
├── mpc/
└── crypto/
```

---

## Phase 1: Create Strategy Pattern

### Step 1.1: Create ChainStrategy Interface

**File:** `packages/sdk/src/chains/strategies/ChainStrategy.ts`

```typescript
import { CoreVault } from '@core/vault'
import { Balance } from '../../types'
import { SmartBalanceResolver } from '../../vault/balance/blockchair/integration'

/**
 * Common interface for chain-specific operations.
 * Each chain (EVM, Solana, Bitcoin, etc.) implements this interface.
 */
export interface ChainStrategy {
  /**
   * The chain identifier (e.g., 'Ethereum', 'Solana')
   */
  readonly chainId: string

  /**
   * Derive address for a vault on this chain
   */
  deriveAddress(vault: CoreVault): Promise<string>

  /**
   * Get balance for an address on this chain
   * @param address The address to check
   * @param balanceResolver Optional balance resolver (for Blockchair integration)
   */
  getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance>

  /**
   * Parse a raw transaction for this chain
   * @param rawTx Raw transaction data (format varies by chain)
   */
  parseTransaction(rawTx: any): Promise<ParsedTransaction>

  /**
   * Build keysign payload for MPC signing
   * @param tx Parsed transaction
   * @param vaultPublicKey Vault's public key
   * @param options Additional options
   */
  buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload>

  /**
   * Estimate gas for a transaction (if applicable)
   * Optional - not all chains support gas estimation
   */
  estimateGas?(tx: any): Promise<GasEstimate>
}

/**
 * Generic parsed transaction type
 * Chain-specific implementations can extend this
 */
export interface ParsedTransaction {
  type: string
  from?: string
  to?: string
  value?: string | bigint
  data?: string
  chainId?: string | number
  [key: string]: any  // Allow chain-specific fields
}

/**
 * Keysign payload for MPC operations
 */
export interface KeysignPayload {
  vaultPublicKey: string
  transaction: string
  chain: string
  skipBroadcast?: boolean
  [key: string]: any
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  [key: string]: any
}

/**
 * Options for keysign payload building
 */
export interface KeysignOptions {
  skipBroadcast?: boolean
  [key: string]: any
}
```

**Key Design Decisions:**
- Interface defines common operations all chains must support
- `parseTransaction` and `buildKeysignPayload` return generic types but allow chain-specific fields
- `estimateGas` is optional (not all chains have gas)
- `getBalance` takes optional resolver for Blockchair integration

---

### Step 1.2: Create ChainStrategyFactory

**File:** `packages/sdk/src/chains/strategies/ChainStrategyFactory.ts`

```typescript
import { ChainStrategy } from './ChainStrategy'

/**
 * Factory for chain strategies.
 * Manages registration and lookup of chain-specific implementations.
 */
export class ChainStrategyFactory {
  private strategies = new Map<string, ChainStrategy>()

  /**
   * Register a chain strategy
   * @param chainId Chain identifier (e.g., 'Ethereum', 'Solana')
   * @param strategy Strategy implementation
   */
  register(chainId: string, strategy: ChainStrategy): void {
    this.strategies.set(chainId, strategy)
  }

  /**
   * Get strategy for a chain
   * @param chainId Chain identifier
   * @throws Error if chain not supported
   */
  getStrategy(chainId: string): ChainStrategy {
    const strategy = this.strategies.get(chainId)
    if (!strategy) {
      const supported = Array.from(this.strategies.keys()).join(', ')
      throw new Error(
        `Unsupported chain: ${chainId}. Supported chains: ${supported}`
      )
    }
    return strategy
  }

  /**
   * Check if a chain is supported
   * @param chainId Chain identifier
   */
  isSupported(chainId: string): boolean {
    return this.strategies.has(chainId)
  }

  /**
   * Get all supported chain identifiers
   */
  getSupportedChains(): string[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * Register all EVM chains with a single strategy instance per chain
   * @param evmChains List of EVM chain identifiers
   * @param strategyFactory Factory function to create strategy for each chain
   */
  registerEvmChains(
    evmChains: string[],
    strategyFactory: (chainId: string) => ChainStrategy
  ): void {
    for (const chainId of evmChains) {
      this.register(chainId, strategyFactory(chainId))
    }
  }
}

/**
 * Create a default factory with all supported chains registered
 */
export function createDefaultStrategyFactory(): ChainStrategyFactory {
  const factory = new ChainStrategyFactory()

  // Register EVM chains
  const evmChains = [
    'Ethereum',
    'Arbitrum',
    'Base',
    'Blast',
    'Optimism',
    'Zksync',
    'Mantle',
    'Avalanche',
    'CronosChain',
    'BSC',
    'Polygon'
  ]

  // Import strategy classes (dynamic to avoid circular deps)
  const { EvmStrategy } = require('../evm/EvmStrategy')
  const { SolanaStrategy } = require('../solana/SolanaStrategy')

  // Register all EVM chains (they share same strategy with different config)
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))

  // Register Solana
  factory.register('Solana', new SolanaStrategy())

  return factory
}
```

**Key Design Decisions:**
- Factory manages all strategy instances
- Helper method `registerEvmChains` for bulk EVM registration
- `createDefaultStrategyFactory` provides pre-configured factory
- Clear error messages for unsupported chains

---

### Step 1.3: Create EvmStrategy

**File:** `packages/sdk/src/chains/evm/EvmStrategy.ts`

```typescript
import { CoreVault } from '@core/vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  GasEstimate,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance } from '../../types'
import { SmartBalanceResolver } from '../../vault/balance/blockchair/integration'
import { getChainId } from './config'
import { parseEvmTransaction } from './parsers/transaction'
import { buildEvmKeysignPayload } from './keysign'
import { estimateTransactionGas } from './gas/estimation'
import { ParsedEvmTransaction, EvmChain } from './types'

// Import core utilities for address derivation
import { getPublicKey, deriveAddress } from '@core/address'

/**
 * Strategy implementation for EVM-compatible chains.
 * Wraps all EVM-specific utilities and provides unified interface.
 */
export class EvmStrategy implements ChainStrategy {
  readonly chainId: string
  private readonly evmChain: EvmChain
  private readonly chainIdNum: number

  constructor(chainId: string) {
    this.chainId = chainId
    this.evmChain = chainId as EvmChain
    this.chainIdNum = getChainId(this.evmChain)
  }

  /**
   * Derive Ethereum address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    // Get wallet core instance (should be passed via context in real implementation)
    const walletCore = await this.getWalletCore()

    // Get ECDSA public key
    const publicKey = getPublicKey({
      chain: this.evmChain,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
      derivePath: "m/44'/60'/0'/0/0"  // EVM derivation path
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: this.evmChain,
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for Ethereum address
   * Uses Blockchair if available, falls back to RPC
   */
  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    if (balanceResolver) {
      // Use Blockchair with RPC fallback
      return balanceResolver.getBalance(this.evmChain, address)
    }

    // Fallback to direct RPC call via core
    const { getCoinBalance } = require('@core/balance')
    return getCoinBalance(this.evmChain, address)
  }

  /**
   * Parse EVM transaction (RLP-encoded)
   */
  async parseTransaction(rawTx: string | Uint8Array): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    const parsed = await parseEvmTransaction(walletCore, rawTx)
    return parsed as ParsedTransaction
  }

  /**
   * Build keysign payload for EVM transaction
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const evmTx = tx as ParsedEvmTransaction

    // Build EVM-specific keysign payload
    const payload = await buildEvmKeysignPayload({
      parsedTransaction: evmTx,
      rawTransaction: evmTx.rawTransaction || '',
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast ?? false
    })

    return payload
  }

  /**
   * Estimate gas for EVM transaction
   */
  async estimateGas(tx: any): Promise<GasEstimate> {
    const estimate = await estimateTransactionGas(this.evmChain, {
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value ?? 0n
    })

    return {
      gasLimit: estimate.gasLimit,
      maxFeePerGas: estimate.maxFeePerGas,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
      gasPrice: estimate.gasPrice
    }
  }

  /**
   * Get WalletCore instance
   * In real implementation, this should be injected via constructor or context
   */
  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
```

**Key Design Decisions:**
- Wraps all existing EVM utilities (parseEvmTransaction, buildEvmKeysignPayload, etc.)
- Integrates with Blockchair via `balanceResolver` parameter
- Uses core utilities for address derivation
- Each EVM chain gets its own strategy instance with correct chainId

---

### Step 1.4: Create SolanaStrategy

**File:** `packages/sdk/src/chains/solana/SolanaStrategy.ts`

```typescript
import { CoreVault } from '@core/vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance } from '../../types'
import { SmartBalanceResolver } from '../../vault/balance/blockchair/integration'
import { parseSolanaTransaction } from './parsers/transaction'
import { buildSolanaKeysignPayload } from './keysign'
import { ParsedSolanaTransaction } from './types'

// Import core utilities for address derivation
import { getPublicKey, deriveAddress } from '@core/address'

/**
 * Strategy implementation for Solana.
 * Wraps all Solana-specific utilities and provides unified interface.
 */
export class SolanaStrategy implements ChainStrategy {
  readonly chainId = 'Solana'

  /**
   * Derive Solana address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Get Ed25519 public key (Solana uses Ed25519, not ECDSA)
    const publicKey = getPublicKey({
      chain: 'Solana',
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
      derivePath: "m/44'/501'/0'/0'"  // Solana derivation path
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: 'Solana',
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for Solana address
   * Uses Blockchair if available, falls back to RPC
   */
  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    if (balanceResolver) {
      // Use Blockchair with RPC fallback
      return balanceResolver.getBalance('Solana', address)
    }

    // Fallback to direct RPC call via core
    const { getCoinBalance } = require('@core/balance')
    return getCoinBalance('Solana', address)
  }

  /**
   * Parse Solana transaction (base64 or Buffer)
   */
  async parseTransaction(rawTx: string | Buffer): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    const parsed = await parseSolanaTransaction(walletCore, rawTx)
    return parsed as ParsedTransaction
  }

  /**
   * Build keysign payload for Solana transaction
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const solanaTx = tx as ParsedSolanaTransaction

    // Build Solana-specific keysign payload
    const payload = await buildSolanaKeysignPayload({
      parsedTransaction: solanaTx,
      serializedTransaction: solanaTx.serializedTransaction || '',
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast ?? false
    })

    return payload
  }

  /**
   * Solana doesn't have gas estimation in the same way as EVM
   * Transaction fees are deterministic
   */
  // estimateGas is not implemented (optional in interface)

  /**
   * Get WalletCore instance
   * In real implementation, this should be injected via constructor or context
   */
  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
```

**Key Design Decisions:**
- Similar structure to EvmStrategy but Solana-specific
- Uses Ed25519 instead of ECDSA
- Different derivation path
- No gas estimation (Solana fees are deterministic)

---

### Step 1.5: Update Chain Index Files

**File:** `packages/sdk/src/chains/evm/index.ts`

```typescript
// Only export the strategy and essential types
export { EvmStrategy } from './EvmStrategy'
export type {
  ParsedEvmTransaction,
  EvmToken,
  EvmGasEstimate,
  EvmChain,
  EvmTransactionType
} from './types'

// Everything else (parsers, utilities, config) is internal
// Internal code can still import them directly:
// import { parseEvmTransaction } from './parsers/transaction'
```

**File:** `packages/sdk/src/chains/solana/index.ts`

```typescript
// Only export the strategy and essential types
export { SolanaStrategy } from './SolanaStrategy'
export type {
  ParsedSolanaTransaction,
  SolanaTransactionType
} from './types'

// Everything else is internal
```

---

## Phase 2: Create Service Layer

### Step 2.1: Create AddressService

**File:** `packages/sdk/src/vault/services/AddressService.ts`

```typescript
import { CoreVault } from '@core/vault'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'

/**
 * Service for coordinating address derivation across chains.
 * Uses strategy pattern to delegate to chain-specific implementations.
 */
export class AddressService {
  constructor(private strategyFactory: ChainStrategyFactory) {}

  /**
   * Derive address for a vault on a specific chain
   * @param vault Vault data
   * @param chain Chain identifier (e.g., 'Ethereum', 'Solana')
   */
  async deriveAddress(vault: CoreVault, chain: string): Promise<string> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.deriveAddress(vault)
  }

  /**
   * Derive addresses for a vault across multiple chains
   * @param vault Vault data
   * @param chains List of chain identifiers
   */
  async deriveMultipleAddresses(
    vault: CoreVault,
    chains: string[]
  ): Promise<Record<string, string>> {
    const addresses: Record<string, string> = {}

    // Derive in parallel for better performance
    await Promise.all(
      chains.map(async (chain) => {
        try {
          addresses[chain] = await this.deriveAddress(vault, chain)
        } catch (error) {
          console.error(`Failed to derive address for ${chain}:`, error)
          // Continue with other chains even if one fails
        }
      })
    )

    return addresses
  }

  /**
   * Check if a chain is supported
   * @param chain Chain identifier
   */
  isSupported(chain: string): boolean {
    return this.strategyFactory.isSupported(chain)
  }

  /**
   * Get all supported chains
   */
  getSupportedChains(): string[] {
    return this.strategyFactory.getSupportedChains()
  }
}
```

**Key Design Decisions:**
- Service coordinates, strategies implement
- Parallel address derivation for better performance
- Error handling per chain (don't fail all if one fails)
- Exposes chain support queries

---

### Step 2.2: Create BalanceService

**File:** `packages/sdk/src/vault/services/BalanceService.ts`

```typescript
import { Balance } from '../../types'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { SmartBalanceResolver } from '../balance/blockchair/integration'

/**
 * Service for coordinating balance fetching across chains.
 * Integrates Blockchair for faster responses with RPC fallback.
 */
export class BalanceService {
  constructor(
    private strategyFactory: ChainStrategyFactory,
    private balanceResolver?: SmartBalanceResolver
  ) {}

  /**
   * Fetch balance for an address on a specific chain
   * @param chain Chain identifier
   * @param address Address to check
   */
  async fetchBalance(chain: string, address: string): Promise<Balance> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.getBalance(address, this.balanceResolver)
  }

  /**
   * Fetch balances for multiple chains
   * @param addresses Map of chain to address
   */
  async fetchBalances(
    addresses: Record<string, string>
  ): Promise<Record<string, Balance>> {
    const balances: Record<string, Balance> = {}

    // Fetch in parallel
    await Promise.all(
      Object.entries(addresses).map(async ([chain, address]) => {
        try {
          balances[chain] = await this.fetchBalance(chain, address)
        } catch (error) {
          console.error(`Failed to fetch balance for ${chain}:`, error)
          // Return zero balance on error
          balances[chain] = {
            chain,
            address,
            value: '0',
            decimals: 18,
            symbol: chain
          }
        }
      })
    )

    return balances
  }

  /**
   * Set or update the balance resolver (for Blockchair configuration)
   * @param resolver New balance resolver
   */
  setBalanceResolver(resolver: SmartBalanceResolver): void {
    this.balanceResolver = resolver
  }
}
```

**Key Design Decisions:**
- Integrates Blockchair via resolver parameter
- Parallel balance fetching
- Error handling returns zero balance instead of throwing
- Configurable balance resolver

---

### Step 2.3: Create SigningService

**File:** `packages/sdk/src/vault/services/SigningService.ts`

```typescript
import { CoreVault } from '@core/vault'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { SigningPayload, Signature } from '../../types'
import { ParsedTransaction } from '../../chains/strategies/ChainStrategy'

/**
 * Service for coordinating transaction signing across chains.
 * Validates payloads and delegates to chain-specific strategies.
 */
export class SigningService {
  constructor(private strategyFactory: ChainStrategyFactory) {}

  /**
   * Parse a raw transaction for a specific chain
   * @param chain Chain identifier
   * @param rawTx Raw transaction data
   */
  async parseTransaction(chain: string, rawTx: any): Promise<ParsedTransaction> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.parseTransaction(rawTx)
  }

  /**
   * Build keysign payload from parsed transaction
   * @param chain Chain identifier
   * @param tx Parsed transaction
   * @param vaultPublicKey Vault's public key
   * @param options Additional options
   */
  async buildKeysignPayload(
    chain: string,
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: { skipBroadcast?: boolean }
  ): Promise<any> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.buildKeysignPayload(tx, vaultPublicKey, options)
  }

  /**
   * Estimate gas for a transaction (if chain supports it)
   * @param chain Chain identifier
   * @param tx Transaction to estimate
   */
  async estimateGas(chain: string, tx: any): Promise<any> {
    const strategy = this.strategyFactory.getStrategy(chain)

    if (!strategy.estimateGas) {
      throw new Error(`Gas estimation not supported for chain: ${chain}`)
    }

    return strategy.estimateGas(tx)
  }

  /**
   * Validate signing payload
   * @param payload Signing payload to validate
   */
  validatePayload(payload: SigningPayload): void {
    if (!payload.transaction) {
      throw new Error('Missing transaction in payload')
    }
    if (!payload.chain) {
      throw new Error('Missing chain in payload')
    }
    if (!this.strategyFactory.isSupported(payload.chain)) {
      throw new Error(`Unsupported chain: ${payload.chain}`)
    }
  }
}
```

**Key Design Decisions:**
- Centralized validation
- Wraps strategy operations with error handling
- Exposes gas estimation when available
- Clear error messages

---

### Step 2.4: Create CacheService

**File:** `packages/sdk/src/vault/services/CacheService.ts`

```typescript
/**
 * Cached item with TTL
 */
interface CachedItem<T> {
  value: T
  timestamp: number
}

/**
 * Service for centralized caching logic.
 * Extracted from Vault to make caching reusable and testable.
 */
export class CacheService {
  private cache = new Map<string, CachedItem<any>>()

  /**
   * Get cached item if not expired
   * @param key Cache key
   * @param ttl Time-to-live in milliseconds
   */
  get<T>(key: string, ttl: number): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    const age = Date.now() - item.timestamp
    if (age > ttl) {
      // Expired
      this.cache.delete(key)
      return null
    }

    return item.value as T
  }

  /**
   * Store item in cache
   * @param key Cache key
   * @param value Value to cache
   */
  set<T>(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    })
  }

  /**
   * Clear specific cache entry
   * @param key Cache key
   */
  clear(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear()
  }

  /**
   * Clear expired entries
   * @param ttl Time-to-live in milliseconds
   */
  clearExpired(ttl: number): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get or compute value with caching
   * @param key Cache key
   * @param ttl Time-to-live in milliseconds
   * @param compute Function to compute value if not cached
   */
  async getOrCompute<T>(
    key: string,
    ttl: number,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = this.get<T>(key, ttl)
    if (cached !== null) return cached

    const value = await compute()
    this.set(key, value)
    return value
  }
}
```

**Key Design Decisions:**
- Generic caching with TTL support
- Helper method `getOrCompute` for common pattern
- Periodic cleanup of expired entries
- Simple Map-based implementation (can be upgraded to LRU later)

---

## Phase 3: Integrate Services into Vault

### Step 3.1: Refactor Vault Constructor

**File:** `packages/sdk/src/vault/Vault.ts` (partial - constructor only)

```typescript
import { AddressService } from './services/AddressService'
import { BalanceService } from './services/BalanceService'
import { SigningService } from './services/SigningService'
import { CacheService } from './services/CacheService'
import { createDefaultStrategyFactory } from '../chains/strategies/ChainStrategyFactory'
import { SmartBalanceResolver, blockchairFirstResolver } from './balance/blockchair/integration'

export class Vault {
  // ===== INTERNAL SERVICES (new) =====
  private addressService: AddressService
  private balanceService: BalanceService
  private signingService: SigningService
  private cacheService: CacheService

  // ===== EXISTING PROPERTIES =====
  private vaultData: CoreVault
  private walletCore?: WalletCore
  private wasmManager?: WASMManager
  private _sdkInstance?: any

  // Legacy properties (keep for now, migrate later)
  private chainManager?: ChainManager
  private addressDeriver: AddressDeriver

  constructor(
    vaultData: CoreVault,
    walletCore?: WalletCore,
    wasmManager?: WASMManager,
    sdkInstance?: any,
    // Optional dependency injection for testing
    services?: {
      addressService?: AddressService
      balanceService?: BalanceService
      signingService?: SigningService
      cacheService?: CacheService
    }
  ) {
    this.vaultData = vaultData
    this.walletCore = walletCore
    this.wasmManager = wasmManager
    this._sdkInstance = sdkInstance

    // Initialize services
    if (services) {
      // Injected services (for testing)
      this.addressService = services.addressService!
      this.balanceService = services.balanceService!
      this.signingService = services.signingService!
      this.cacheService = services.cacheService!
    } else {
      // Default services
      const strategyFactory = createDefaultStrategyFactory()
      this.addressService = new AddressService(strategyFactory)
      this.balanceService = new BalanceService(
        strategyFactory,
        blockchairFirstResolver  // Use Blockchair by default
      )
      this.signingService = new SigningService(strategyFactory)
      this.cacheService = new CacheService()
    }

    // Legacy initialization (keep for now)
    this.addressDeriver = new AddressDeriver()
    if (walletCore) {
      this.addressDeriver.initialize(walletCore)
    }
    if (wasmManager) {
      this.chainManager = new ChainManager(wasmManager)
      this.chainManager.initialize()
    }
  }

  // ... rest of Vault methods (refactored in next steps)
}
```

**Key Design Decisions:**
- Services injected via constructor (dependency injection)
- Default services created if not provided
- Legacy properties kept for gradual migration
- Blockchair enabled by default

---

### Step 3.2: Refactor address() Method

**File:** `packages/sdk/src/vault/Vault.ts` (partial - address method)

```typescript
export class Vault {
  // ... constructor from above

  /**
   * Get address for a specific chain
   * PUBLIC API - Must not change signature
   */
  async address(chain: string): Promise<string>
  async address(input: string | AddressInput): Promise<string>
  async address(input: string | AddressInput): Promise<string> {
    // Handle overloaded signature
    const chainStr = typeof input === 'string' ? input : input.chain

    // Check cache first
    const cacheKey = `address:${chainStr}`
    const cached = this.cacheService.get<string>(cacheKey, Infinity)  // Addresses never expire
    if (cached) return cached

    // Derive address using service
    const address = await this.addressService.deriveAddress(this.vaultData, chainStr)

    // Cache result
    this.cacheService.set(cacheKey, address)

    return address
  }

  /**
   * Get addresses for multiple chains
   * PUBLIC API - Must not change signature
   */
  async addresses(chains?: string[]): Promise<Record<string, string>> {
    // Use vault's chains if not specified
    const chainsToUse = chains || this.getChains()

    // Use service for batch derivation
    return this.addressService.deriveMultipleAddresses(this.vaultData, chainsToUse)
  }
}
```

**Key Changes:**
- Uses `addressService` instead of direct imports
- Uses `cacheService` for caching
- Public API signature unchanged
- Internal implementation completely different

---

### Step 3.3: Refactor balance() Method

**File:** `packages/sdk/src/vault/Vault.ts` (partial - balance method)

```typescript
export class Vault {
  // ... previous methods

  /**
   * Get balance for a specific chain
   * PUBLIC API - Must not change signature
   */
  async balance(chain: string, tokenId?: string): Promise<Balance> {
    // Get address first
    const address = await this.address(chain)

    // Check cache
    const cacheKey = `balance:${chain}:${address}:${tokenId || 'native'}`
    const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)  // 5 min TTL
    if (cached) return cached

    // Fetch balance using service
    const balance = await this.balanceService.fetchBalance(chain, address)

    // Cache result
    this.cacheService.set(cacheKey, balance)

    return balance
  }

  /**
   * Get balances for multiple chains
   * PUBLIC API - Must not change signature
   */
  async balances(
    chains?: string[],
    includeTokens?: boolean
  ): Promise<Record<string, Balance>> {
    const chainsToUse = chains || this.getChains()

    // Get addresses first
    const addresses = await this.addresses(chainsToUse)

    // Fetch balances using service
    return this.balanceService.fetchBalances(addresses)
  }

  /**
   * Force refresh balance (bypass cache)
   * PUBLIC API - Must not change signature
   */
  async updateBalance(chain: string, tokenId?: string): Promise<Balance> {
    // Clear cache
    const address = await this.address(chain)
    const cacheKey = `balance:${chain}:${address}:${tokenId || 'native'}`
    this.cacheService.clear(cacheKey)

    // Fetch fresh balance
    return this.balance(chain, tokenId)
  }

  /**
   * Force refresh balances for multiple chains
   * PUBLIC API - Must not change signature
   */
  async updateBalances(
    chains?: string[],
    includeTokens?: boolean
  ): Promise<Record<string, Balance>> {
    // Clear caches for all chains
    const chainsToUse = chains || this.getChains()
    for (const chain of chainsToUse) {
      const address = await this.address(chain)
      const cacheKey = `balance:${chain}:${address}:native`
      this.cacheService.clear(cacheKey)
    }

    // Fetch fresh balances
    return this.balances(chainsToUse, includeTokens)
  }
}
```

**Key Changes:**
- Uses `balanceService` with Blockchair integration
- Uses `cacheService` for caching with 5-minute TTL
- `updateBalance` clears cache before fetching
- Public API unchanged

---

### Step 3.4: Refactor sign() Method

**File:** `packages/sdk/src/vault/Vault.ts` (partial - sign method)

```typescript
export class Vault {
  // ... previous methods

  /**
   * Sign transaction
   * PUBLIC API - Must not change signature
   */
  async sign(
    mode: SigningMode,
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    // Validate payload using service
    this.signingService.validatePayload(payload)

    // Validate signing mode
    this.validateSigningMode(mode)

    // Delegate to appropriate signing method based on mode
    switch (mode) {
      case 'fast':
        return this.signFast(payload, password)
      case 'relay':
        return this.signRelay(payload, password)
      case 'local':
        return this.signLocal(payload, password)
      default:
        throw new Error(`Unsupported signing mode: ${mode}`)
    }
  }

  /**
   * Fast signing via server
   */
  private async signFast(
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    // Implementation remains similar but can use signingService for parsing
    // ... existing signFast logic
  }

  /**
   * Estimate gas for transaction
   * PUBLIC API - Currently placeholder
   */
  async estimateGas(tx: any, chain: string): Promise<any> {
    // Now actually implemented using signing service
    return this.signingService.estimateGas(chain, tx)
  }
}
```

**Key Changes:**
- Uses `signingService` for validation and gas estimation
- `estimateGas()` now actually works instead of throwing error
- Public API unchanged

---

## Phase 4: Enhance ChainManager

### Step 4.1: Integrate Blockchair into ChainManager

**File:** `packages/sdk/src/chains/ChainManager.ts`

```typescript
import { WASMManager } from '../wasm/WASMManager'
import { AddressDeriver } from './AddressDeriver'
import { Balance } from '../types'
import { Chain, ChainKind } from '@core/chain'
import { SmartBalanceResolver, blockchairFirstResolver } from '../vault/balance/blockchair/integration'

export class ChainManager {
  private addressDeriver = new AddressDeriver()
  private balanceResolver: SmartBalanceResolver

  constructor(
    private wasmManager: WASMManager,
    config?: {
      preferBlockchair?: boolean
    }
  ) {
    // Initialize balance resolver with Blockchair support
    this.balanceResolver = config?.preferBlockchair === false
      ? null  // RPC-only mode
      : blockchairFirstResolver  // Blockchair with RPC fallback
  }

  async initialize(): Promise<void> {
    const walletCore = await this.wasmManager.getWalletCore()
    this.addressDeriver.initialize(walletCore)
  }

  /**
   * Get balances for addresses
   * Now uses Blockchair with RPC fallback
   */
  async getBalances(
    addresses: Record<string, string>
  ): Promise<Record<string, Balance>> {
    const balances: Record<string, Balance> = {}

    await Promise.all(
      Object.entries(addresses).map(async ([chain, address]) => {
        balances[chain] = await this.getChainBalance(chain as Chain, address)
      })
    )

    return balances
  }

  /**
   * Get balance for a single chain
   * Enhanced with Blockchair integration
   */
  private async getChainBalance(chain: Chain, address: string): Promise<Balance> {
    if (this.balanceResolver) {
      // Use Blockchair with automatic RPC fallback
      try {
        return await this.balanceResolver.getBalance(chain, address)
      } catch (error) {
        console.warn(`Blockchair failed for ${chain}, using RPC:`, error)
        // Fallback is handled by SmartBalanceResolver
      }
    }

    // Direct RPC call (legacy or Blockchair-disabled mode)
    const { getCoinBalance } = require('@core/balance')
    return getCoinBalance(chain, address)
  }

  // ... rest of ChainManager methods unchanged
}
```

**Key Changes:**
- Integrated `SmartBalanceResolver` from Blockchair system
- Configurable Blockchair preference
- Automatic fallback to RPC
- Faster balance fetching with Blockchair

---

## Phase 5: Clean Up Exports

### Step 5.1: Create Minimal index.ts

**File:** `packages/sdk/src/index.ts` (complete replacement)

```typescript
/**
 * Vultisig SDK - Public API
 *
 * This is the ONLY file that defines the public API.
 * Everything else is internal implementation.
 */

// ===== CORE SDK =====
export { Vultisig } from './VultisigSDK'
export { Vault, VaultError, VaultErrorCode } from './vault'

// ===== ESSENTIAL TYPES =====
export type {
  // Vault operations
  Balance,
  Signature,
  SigningPayload,
  SigningMode,
  VaultSummary,
  CreateVaultOptions,
  FastVaultOptions,

  // Address book
  AddressBookEntry,
  AddressBook,

  // Server
  ServerStatus,

  // Validation
  ValidationResult
} from './types'

// ===== CHAIN-SPECIFIC TYPES (for TypeScript users) =====

// EVM types
export type {
  ParsedEvmTransaction,
  EvmToken,
  EvmGasEstimate,
  EvmChain,
  EvmTransactionType,
  EvmProtocol
} from './chains/evm/types'

// Solana types
export type {
  ParsedSolanaTransaction,
  SolanaTransactionType
} from './chains/solana/types'

// ===== ADVANCED FEATURES (for power users) =====

// Blockchair integration for advanced balance fetching
export {
  BalanceProviders,
  SmartBalanceResolver,
  blockchairFirstResolver,
  rpcOnlyResolver,
  selectiveBlockchairResolver
} from './vault/balance'

// That's it! Everything else is internal implementation.
// Users should interact via Vultisig and Vault classes.
```

**Key Changes:**
- **92% reduction**: From 120+ exports to 10-15
- Only essentials exported
- Clear comments explaining what's public
- Advanced features (Blockchair) available for power users
- All implementation details hidden

---

### Step 5.2: Add Deprecation Warnings (Optional Transition Period)

**File:** `packages/sdk/src/index.deprecated.ts` (temporary file for v2.x)

```typescript
/**
 * Deprecated exports with warnings.
 * These will be removed in v3.0.
 */

// Re-export deprecated items with warnings
import { parseEvmTransaction as _parseEvmTransaction } from './chains/evm/parsers/transaction'
import { ChainManager as _ChainManager } from './chains/ChainManager'
// ... other deprecated exports

/**
 * @deprecated Use vault.sign() instead. Will be removed in v3.0.
 */
export const parseEvmTransaction = (...args: any[]) => {
  console.warn(
    'DEPRECATED: parseEvmTransaction is deprecated and will be removed in v3.0. ' +
    'Use vault.sign() for transaction operations. ' +
    'See migration guide: https://docs.vultisig.com/migration'
  )
  return _parseEvmTransaction(...args)
}

/**
 * @deprecated Internal implementation. Will be removed in v3.0.
 */
export const ChainManager = _ChainManager
// Add deprecation warning to constructor if possible

// ... more deprecated exports with warnings
```

**Then in main index.ts (v2.x only):**
```typescript
// ... essential exports from above

// Deprecated exports (v2.x only, remove in v3.0)
export * from './index.deprecated'
```

**Key Benefits:**
- Users get warnings but code still works
- Clear migration path
- Scheduled removal in next major version

---

## Phase 6: Delete Redundant Code

### Step 6.1: Delete BalanceManagement.ts

**Command:**
```bash
rm packages/sdk/src/vault/BalanceManagement.ts
```

**Update `packages/sdk/src/vault/index.ts`:**
```typescript
// Remove this line:
// export { BalanceManagement } from './BalanceManagement'

// Keep other exports:
export { Vault } from './Vault'
export { VaultError, VaultErrorCode } from './VaultError'
export { AddressBookManager } from './AddressBook'
export { ChainManagement } from './ChainManagement'
export { VaultManagement } from './VaultManagement'
export { BalanceProviders } from './balance'
```

**Verification:**
```bash
# Search for any imports of BalanceManagement
grep -r "BalanceManagement" packages/sdk/src/
# Should return zero results (except in git history)
```

---

### Step 6.2: Remove Internal Exports from index.ts

**File:** `packages/sdk/src/index.ts` (v3.0)

Remove all deprecated exports:
```typescript
// ❌ REMOVE these exports:
// export { ChainManager, AddressDeriver } from './chains'
// export { AddressBookManager, ChainManagement, VaultManagement } from './vault'
// export { parseEvmTransaction, estimateTransactionGas, ... } from './chains/evm'
// export { parseSolanaTransaction, ... } from './chains/solana'
// export * from './mpc'
// export * from './server'
// export * from './crypto'
// export * from './wasm'

// ✅ KEEP only the exports from Step 5.1 above
```

---

## Testing Strategy

### Unit Tests

**Test Services:**

```typescript
// vault/services/__tests__/AddressService.test.ts
describe('AddressService', () => {
  let service: AddressService
  let mockFactory: ChainStrategyFactory
  let mockStrategy: ChainStrategy

  beforeEach(() => {
    mockStrategy = {
      chainId: 'Ethereum',
      deriveAddress: jest.fn().mockResolvedValue('0xMOCKADDRESS'),
      getBalance: jest.fn(),
      parseTransaction: jest.fn(),
      buildKeysignPayload: jest.fn()
    }

    mockFactory = new ChainStrategyFactory()
    mockFactory.register('Ethereum', mockStrategy)

    service = new AddressService(mockFactory)
  })

  it('should derive address using strategy', async () => {
    const mockVault = { /* ... */ }
    const address = await service.deriveAddress(mockVault, 'Ethereum')

    expect(address).toBe('0xMOCKADDRESS')
    expect(mockStrategy.deriveAddress).toHaveBeenCalledWith(mockVault)
  })

  it('should derive multiple addresses in parallel', async () => {
    const mockVault = { /* ... */ }
    const addresses = await service.deriveMultipleAddresses(
      mockVault,
      ['Ethereum', 'Ethereum']
    )

    expect(Object.keys(addresses)).toHaveLength(2)
  })
})
```

**Test Strategies:**

```typescript
// chains/evm/__tests__/EvmStrategy.test.ts
describe('EvmStrategy', () => {
  let strategy: EvmStrategy

  beforeEach(() => {
    strategy = new EvmStrategy('Ethereum')
  })

  it('should derive Ethereum address', async () => {
    const mockVault = { /* ... */ }
    const address = await strategy.deriveAddress(mockVault)

    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('should get balance with Blockchair', async () => {
    const mockResolver = {
      getBalance: jest.fn().mockResolvedValue({
        chain: 'Ethereum',
        value: '1000000000000000000',
        decimals: 18
      })
    }

    const balance = await strategy.getBalance('0x...', mockResolver)

    expect(mockResolver.getBalance).toHaveBeenCalledWith('Ethereum', '0x...')
    expect(balance.value).toBe('1000000000000000000')
  })
})
```

---

### Integration Tests

**Test Vault with Services:**

```typescript
// vault/__tests__/Vault.integration.test.ts
describe('Vault Integration', () => {
  let vault: Vault
  let mockServices: any

  beforeEach(() => {
    // Create mock services
    mockServices = {
      addressService: {
        deriveAddress: jest.fn().mockResolvedValue('0xMOCK'),
        deriveMultipleAddresses: jest.fn().mockResolvedValue({
          Ethereum: '0xMOCK1',
          Solana: 'MOCK2'
        })
      },
      balanceService: {
        fetchBalance: jest.fn().mockResolvedValue({
          chain: 'Ethereum',
          value: '1000000000000000000',
          decimals: 18
        })
      },
      signingService: {
        validatePayload: jest.fn()
      },
      cacheService: new CacheService()
    }

    // Create vault with mock services
    vault = new Vault(mockVaultData, mockCore, mockWasm, null, mockServices)
  })

  it('should get address using address service', async () => {
    const address = await vault.address('Ethereum')

    expect(address).toBe('0xMOCK')
    expect(mockServices.addressService.deriveAddress).toHaveBeenCalled()
  })

  it('should cache addresses', async () => {
    // First call
    await vault.address('Ethereum')
    // Second call
    await vault.address('Ethereum')

    // Service should only be called once (second call uses cache)
    expect(mockServices.addressService.deriveAddress).toHaveBeenCalledTimes(1)
  })

  it('should get balance using balance service', async () => {
    const balance = await vault.balance('Ethereum')

    expect(balance.value).toBe('1000000000000000000')
    expect(mockServices.balanceService.fetchBalance).toHaveBeenCalled()
  })
})
```

---

### End-to-End Tests

**Test Public API:**

```typescript
// __tests__/e2e/public-api.test.ts
describe('Public API (E2E)', () => {
  let sdk: Vultisig
  let vault: Vault

  beforeAll(async () => {
    sdk = new Vultisig()
    await sdk.initialize()
  })

  it('should create vault and get address', async () => {
    vault = await sdk.createVault('test-vault', {
      email: 'test@example.com',
      password: 'TestPass123!'
    })

    const ethAddress = await vault.address('Ethereum')
    expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('should get balance', async () => {
    const balance = await vault.balance('Ethereum')

    expect(balance).toHaveProperty('chain')
    expect(balance).toHaveProperty('value')
    expect(balance).toHaveProperty('decimals')
  })

  it('should handle unsupported chain', async () => {
    await expect(vault.address('InvalidChain')).rejects.toThrow()
  })
})
```

---

## Implementation Checklist

### Phase 1: Strategy Pattern (1-2 weeks)

- [ ] Create `chains/strategies/ChainStrategy.ts` interface
- [ ] Create `chains/strategies/ChainStrategyFactory.ts`
- [ ] Create `chains/evm/EvmStrategy.ts`
- [ ] Create `chains/solana/SolanaStrategy.ts`
- [ ] Update `chains/evm/index.ts` to only export strategy
- [ ] Update `chains/solana/index.ts` to only export strategy
- [ ] Write unit tests for strategies
- [ ] Write unit tests for factory

### Phase 2: Service Layer (1 week)

- [ ] Create `vault/services/AddressService.ts`
- [ ] Create `vault/services/BalanceService.ts`
- [ ] Create `vault/services/SigningService.ts`
- [ ] Create `vault/services/CacheService.ts`
- [ ] Write unit tests for all services

### Phase 3: Integrate into Vault (1 week)

- [ ] Refactor `Vault` constructor to accept/create services
- [ ] Refactor `vault.address()` to use AddressService
- [ ] Refactor `vault.addresses()` to use AddressService
- [ ] Refactor `vault.balance()` to use BalanceService + CacheService
- [ ] Refactor `vault.balances()` to use BalanceService
- [ ] Refactor `vault.updateBalance()` to use BalanceService + CacheService
- [ ] Refactor `vault.updateBalances()` to use BalanceService + CacheService
- [ ] Refactor `vault.sign()` to use SigningService
- [ ] Implement `vault.estimateGas()` using SigningService
- [ ] Run full test suite - verify all tests pass
- [ ] Manual testing of all refactored methods

### Phase 4: Enhance ChainManager (3 days)

- [ ] Integrate SmartBalanceResolver into ChainManager
- [ ] Update ChainManager constructor to accept config
- [ ] Update `getChainBalance()` to use Blockchair
- [ ] Test Blockchair integration
- [ ] Test RPC fallback
- [ ] Benchmark performance improvement

### Phase 5: Clean Up Exports (1 week)

- [ ] Create new minimal `index.ts` (10-15 exports)
- [ ] Create `index.deprecated.ts` with warnings (v2.x only)
- [ ] Update documentation to show new import patterns
- [ ] Update all examples to use new API
- [ ] Test that existing code still works (deprecation period)
- [ ] Announce deprecation timeline to users

### Phase 6: Delete Redundant Code (1 day)

- [ ] Delete `vault/BalanceManagement.ts`
- [ ] Remove BalanceManagement export from `vault/index.ts`
- [ ] Remove BalanceManagement export from `index.ts`
- [ ] Verify no references remain (`grep` search)
- [ ] Run full test suite
- [ ] Update to v3.0 (remove deprecated exports)

### Documentation

- [ ] Update API documentation
- [ ] Create migration guide (v2 → v3)
- [ ] Update examples repository
- [ ] Create changelog entry
- [ ] Update TypeScript type definitions

### Release

- [ ] v2.x release (with deprecation warnings)
- [ ] v3.0 release (clean API)
- [ ] Blog post explaining changes
- [ ] User communication about migration

---

## Success Verification

After implementation, verify:

1. **Zero Breaking Changes to Public API:**
   ```typescript
   // All existing code should still work
   const vault = await sdk.getVault('my-vault', 'password')
   const address = await vault.address('Ethereum')
   const balance = await vault.balance('Ethereum')
   const signature = await vault.sign('fast', payload)
   ```

2. **Reduced Exports:**
   ```bash
   # Count exports in index.ts
   grep "^export" packages/sdk/src/index.ts | wc -l
   # Should be ~10-15 (vs 120+ before)
   ```

3. **All Tests Pass:**
   ```bash
   npm run test
   # 100% pass rate
   ```

4. **Performance Improvement:**
   ```bash
   # Benchmark balance fetching
   # Should be 5-10x faster with Blockchair
   ```

5. **Internal Implementation Hidden:**
   ```typescript
   // These imports should fail in v3.0
   import { parseEvmTransaction } from 'vultisig-sdk'  // ❌ Error
   import { ChainManager } from 'vultisig-sdk'  // ❌ Error
   import { estimateTransactionGas } from 'vultisig-sdk'  // ❌ Error
   ```

---

**Document Status:** Complete
**Ready for Implementation:** Yes
**Next Steps:** Begin Phase 1 implementation
