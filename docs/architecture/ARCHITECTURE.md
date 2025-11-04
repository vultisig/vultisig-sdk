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
6. [Data Flow](#data-flow)
7. [Chain Support](#chain-support)
8. [Feature Status](#feature-status)
9. [Remaining Work](#remaining-work)
10. [Development Guide](#development-guide)

---

## Overview

The Vultisig SDK is a TypeScript library for creating and managing multi-chain cryptocurrency vaults using threshold signature schemes (TSS). It provides a unified interface for interacting with 34+ blockchain networks through multi-party computation (MPC).

### What It Does

- **Vault Management** - Create, import, and manage cryptocurrency vaults
- **Multi-Chain Support** - Unified API for Bitcoin, Ethereum, Solana, and 30+ other chains
- **MPC Signing** - Secure transaction signing using threshold signatures
- **Balance Tracking** - Query native and token balances across all chains
- **Address Derivation** - Generate addresses for any supported chain
- **Gas Estimation** - Get current gas prices and fee estimates

### Architecture Overview

The SDK is a thin layer over the Vultisig Core library, providing:
- User-friendly API surface
- Data format conversion
- Intelligent caching
- Service coordination (MPC, servers)

**Design Philosophy:** The SDK doesn't duplicate blockchain logic. It delegates to Core and focuses on providing a great developer experience.

---

## Architecture Principles

### 1. Functional Adapter Pattern

The SDK uses functional adapters to convert between Core's data formats and user-friendly SDK types.

```typescript
// Vault calls Core functions directly
class Vault {
  async balance(chain: string): Promise<Balance> {
    // 1. Call Core
    const rawBalance = await getCoinBalance({ chain, address })

    // 2. Format with thin adapter
    return formatBalance(rawBalance, chain)
  }
}
```

**Key characteristics:**
- Direct Core integration (no wrapper layers)
- Adapters are pure formatting functions
- All blockchain logic lives in Core
- SDK focuses on caching and coordination

### 2. Single Source of Truth

Core is the authoritative source for all blockchain operations:
- Address derivation
- Balance queries
- Transaction building
- Fee estimation
- Chain-specific logic

The SDK never reimplements blockchain logic - it always delegates to Core.

### 3. Minimal Abstraction

Only two layers between user code and blockchain operations:

```
User Code → Vault (SDK) → Core Functions → Blockchain
```

Adapters are pure functions sitting between Vault and Core:

```
bigint (Core) → formatBalance() → Balance (SDK type)
```

### 4. Smart Caching

The SDK implements intelligent caching:
- **Addresses:** Cached permanently (never change)
- **Balances:** 5-minute TTL (balances fluctuate)
- **Gas prices:** Not cached (highly volatile)

---

## System Architecture

### Component Diagram

```
┌───────────────────────────────────────────┐
│         User Application                   │
│     (React, Node.js, etc.)                │
└────────────────┬──────────────────────────┘
                 │
            ┌────▼────┐
            │Vultisig │ ← Main SDK entry point
            └────┬────┘
     ┌───────────┼───────────┐
     │           │           │
┌────▼────┐ ┌───▼────┐ ┌───▼─────┐
│  Vault  │ │Address │ │  Chain  │
│ Manager │ │  Book  │ │ Manager │
└────┬────┘ └────────┘ └─────────┘
     │
┌────▼─────────────────────────────────┐
│         Vault (Core Class)            │
│  ┌────────────────────────────────┐  │
│  │ Address │ Balance │ Gas │ Sign │  │
│  │ Tokens  │ Chains  │ Currency   │  │
│  └────────────────────────────────┘  │
└────┬──────────────┬──────────────────┘
     │              │
┌────▼─────┐   ┌───▼──────┐
│ Adapters │   │ Services │
│ (format) │   │ (cache)  │
└────┬─────┘   └───┬──────┘
     │             │
┌────▼─────────────▼──────────────┐
│      Vultisig Core Library      │
│  - deriveAddress()              │
│  - getCoinBalance()             │
│  - getFeeQuote()                │
│  - buildKeysignPayload()        │
│  - keysign()                    │
│  + 34 chain resolvers           │
└─────────────────────────────────┘
```

### Component Responsibilities

| Component | Purpose | Examples |
|-----------|---------|----------|
| **Vultisig** | SDK initialization, vault lifecycle | `createVault()`, `getActiveVault()` |
| **Vault** | Chain operations, signing | `balance()`, `address()`, `sign()` |
| **VaultManager** | Storage, import/export | `addVault()`, `listVaults()` |
| **Adapters** | Data format conversion | `formatBalance()`, `buildKeysignPayload()` |
| **Services** | Caching, MPC coordination | `CacheService`, `FastSigningService` |
| **Managers** | WASM loading, server API | `WASMManager`, `ServerManager` |
| **Core** | All blockchain logic | Address derivation, balances, signing |

---

## Directory Structure

```
packages/sdk/src/
├── index.ts                          # Public API exports
├── VultisigSDK.ts                    # Main SDK class
├── VaultManager.ts                   # Vault lifecycle
├── ChainManager.ts                   # Chain configuration
│
├── vault/                            # Core vault functionality
│   ├── Vault.ts                      # Main vault class (~650 lines)
│   ├── VaultServices.ts              # Service injection interfaces
│   ├── VaultError.ts                 # Error definitions
│   ├── AddressBook.ts                # Global address book
│   │
│   ├── adapters/                     # Data formatting (NO business logic)
│   │   ├── formatBalance.ts          # bigint → Balance
│   │   ├── formatGasInfo.ts          # FeeQuote → GasInfo
│   │   ├── buildKeysignPayload.ts    # Payload → Message hashes
│   │   └── index.ts
│   │
│   ├── services/                     # Essential services
│   │   ├── CacheService.ts           # TTL-based caching
│   │   ├── FastSigningService.ts     # Server MPC signing
│   │   └── index.ts
│   │
│   └── utils/                        # Utilities
│       ├── validation.ts             # Input validation
│       └── export.ts                 # Vault export/backup
│
├── wasm/                             # WASM module management
│   └── WASMManager.ts                # WalletCore, DKLS, Schnorr
│
├── server/                           # Server communication
│   └── ServerManager.ts              # API endpoints & coordination
│
├── chains/                           # Chain utilities (internal)
│   └── utils.ts                      # Validation, type checking
│
└── types/                            # Public type definitions
    └── index.ts                      # Balance, GasInfo, Token, etc.
```

---

## Core Components

### 1. Vultisig (Main SDK Class)

**File:** `VultisigSDK.ts`

The main entry point for the SDK. Manages global state and vault lifecycle.

```typescript
const vultisig = new Vultisig({
  defaultChains: ['Bitcoin', 'Ethereum'],
  defaultCurrency: 'USD',
  serverEndpoints: {
    fastVault: 'https://api.vultisig.com'
  }
})

await vultisig.initialize()
```

**Key Methods:**

| Category | Methods |
|----------|---------|
| **Initialization** | `initialize()` |
| **Vault Lifecycle** | `createVault()`, `createFastVault()`, `getVault()`, `addVault()`, `deleteVault()` |
| **Active Vault** | `setActiveVault()`, `getActiveVault()` |
| **Configuration** | `setDefaultChains()`, `setDefaultCurrency()` |
| **Address Book** | `getAddressBook()`, `addAddressEntry()` |
| **Validation** | `validateEmail()`, `validatePassword()`, `validateVaultName()` |

### 2. Vault (Core Vault Class)

**File:** `vault/Vault.ts`

The primary interface for blockchain operations. Uses functional adapters to call Core functions.

```typescript
const vault = await vultisig.getActiveVault()

// Address derivation (cached permanently)
const address = await vault.address('Ethereum')

// Balance fetching (cached 5 minutes)
const balance = await vault.balance('Ethereum')
const tokenBalance = await vault.balance('Ethereum', '0xA0b86991...')

// Gas estimation
const gasInfo = await vault.gas('Ethereum')

// Signing
const signature = await vault.sign('fast', {
  chain: 'Ethereum',
  transaction: { to, value, data }
}, password)
```

**Method Categories:**

| Category | Methods | Caching |
|----------|---------|---------|
| **Address** | `address()`, `addresses()` | Permanent |
| **Balance** | `balance()`, `balances()`, `updateBalance()` | 5-minute TTL |
| **Gas** | `gas()` | None |
| **Signing** | `sign()`, `signFast()` | None |
| **Tokens** | `setTokens()`, `addToken()`, `removeToken()` | In-memory |
| **Chains** | `setChains()`, `addChain()`, `removeChain()` | In-memory |
| **Info** | `summary()`, `rename()`, `export()` | None |

**Implementation Pattern:**

```typescript
async balance(chain: string, tokenId?: string): Promise<Balance> {
  const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`

  // Check cache (5-min TTL)
  const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)
  if (cached) return cached

  // Get address
  const address = await this.address(chain)

  // Call Core directly
  const rawBalance = await getCoinBalance({
    chain: ChainConfig.getChainEnum(chain),
    address,
    contractAddress: tokenId
  })

  // Format with adapter
  const balance = formatBalance(rawBalance, chain, tokenId, this._tokens)

  // Cache and return
  this.cacheService.set(cacheKey, balance)
  return balance
}
```

### 3. Adapters (Data Formatting Layer)

**Location:** `vault/adapters/`

Pure functions that convert between Core and SDK data formats. No business logic.

#### formatBalance.ts

Converts Core's bigint balance to SDK's structured Balance type.

```typescript
export function formatBalance(
  rawBalance: bigint,
  chain: string,
  tokenId?: string,
  tokens?: Record<string, Token[]>
): Balance {
  let decimals: number
  let symbol: string

  if (tokenId) {
    // Token balance - look up metadata
    const token = tokens?.[chain]?.find(t => t.id === tokenId)
    decimals = token?.decimals ?? 18
    symbol = token?.symbol ?? tokenId
  } else {
    // Native balance - use chain metadata
    decimals = ChainConfig.getDecimals(chain)
    symbol = ChainConfig.getSymbol(chain)
  }

  return {
    amount: rawBalance.toString(),
    symbol,
    decimals,
    chainId: chain,
    tokenId
  }
}
```

#### formatGasInfo.ts

Converts Core's FeeQuote to SDK's GasInfo with chain-specific formatting.

```typescript
export function formatGasInfo(feeQuote: any, chain: string): GasInfo {
  const chainType = ChainConfig.getType(chain)

  // EVM chains have complex gas structure
  if (chainType === 'evm') {
    return {
      chainId: chain,
      gasPrice: feeQuote.gasPrice?.toString() ?? '0',
      gasPriceGwei: feeQuote.gasPriceGwei?.toString(),
      maxFeePerGas: feeQuote.maxFeePerGas?.toString(),
      priorityFee: feeQuote.priorityFee?.toString(),
      lastUpdated: Date.now()
    }
  }

  // Other chains - simpler structure
  return {
    chainId: chain,
    gasPrice: feeQuote.toString(),
    lastUpdated: Date.now()
  }
}
```

#### buildKeysignPayload.ts

Builds message hashes for MPC signing using Core's keysign functions.

```typescript
export async function buildKeysignPayload(
  sdkPayload: SigningPayload,
  chain: Chain,
  walletCore: WalletCore,
  vaultData: Vault
): Promise<string[]> {
  // Build complete KeysignPayload using Core
  const keysignPayload = await buildSendKeysignPayload({
    coin: { chain },
    receiver: sdkPayload.transaction.to,
    amount: sdkPayload.transaction.value,
    // ... other fields
  })

  // Get encoded signing inputs (protobuf)
  const signingInputs = getEncodedSigningInputs({
    keysignPayload,
    walletCore,
    publicKey
  })

  // Compute pre-signing hashes
  const messageHashes = signingInputs.flatMap(txInputData => {
    const hashes = getPreSigningHashes({ walletCore, chain, txInputData })
    return hashes.map(hash => Buffer.from(hash).toString('hex'))
  })

  return messageHashes
}
```

### 4. Services

**Location:** `vault/services/`

#### CacheService

Simple in-memory cache with TTL support.

```typescript
class CacheService {
  private cache = new Map<string, { value: any; timestamp: number }>()

  get<T>(key: string, ttl: number): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, { value, timestamp: Date.now() })
  }
}
```

**Usage:**
- Addresses: Permanent cache (`ttl = Infinity`)
- Balances: 5-minute TTL (`ttl = 5 * 60 * 1000`)
- Can be cleared manually via `updateBalance()`

#### FastSigningService

Coordinates server-assisted 2-of-2 MPC signing.

```typescript
class FastSigningService {
  async signWithServer(
    vault: Vault,
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    // Build keysign payload (via adapter)
    const messageHashes = await buildKeysignPayload(payload, ...)

    // Coordinate with ServerManager
    return this.serverManager.coordinateFastSigning({
      vault,
      messageHashes,
      password
    })
  }
}
```

**Flow:**
1. Build keysign payload (message hashes)
2. Initiate session with server API
3. WebSocket MPC coordination
4. Combine partial signatures
5. Return final signature

### 5. Managers

#### VaultManager

Handles vault storage and lifecycle.

```typescript
class VaultManager {
  private vaults = new Map<string, Vault>()

  async createVault(name: string, options): Promise<Vault>
  async addVault(file: File | Buffer, password?): Promise<Vault>
  async listVaults(): Promise<VaultSummary[]>
  async deleteVault(vaultId: string): Promise<void>
  setActiveVault(vaultId: string): void
  getActiveVault(): Vault | null
}
```

#### WASMManager

Lazy-loads three WASM modules.

```typescript
class WASMManager {
  async getWalletCore(): Promise<WalletCore>  // TrustWallet Core
  async initializeDkls(): Promise<void>       // ECDSA MPC
  async initializeSchnorr(): Promise<void>    // EdDSA MPC
}
```

**Features:**
- Lazy loading (only when needed)
- Memoized initialization (load once, reuse)
- Optional custom WASM paths

#### ServerManager

Coordinates all server API calls.

```typescript
class ServerManager {
  async createFastVault(email, password): Promise<Vault>
  async verifyVault(email, code): Promise<void>
  async getVaultFromServer(email, password): Promise<Vault>
  async coordinateFastSigning(session): Promise<Signature>
  async getServerStatus(): Promise<ServerStatus>
}
```

#### ChainManager

SDK-level chain configuration.

```typescript
class ChainManager {
  getSupportedChains(): string[]
  setDefaultChains(chains: string[]): void
  getDefaultChains(): string[]
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
vault.balance('Ethereum', '0xA0b86...')
  │
  ├─→ Check cache (5-min) ────→ [HIT] Return cached
  │
  ├─→ [MISS] Get address via vault.address()
  │
  ├─→ Core: getCoinBalance({ chain, address, contractAddress })
  │     Output: rawBalance (bigint)
  │
  ├─→ Adapter: formatBalance(rawBalance, chain, tokenId)
  │     Output: Balance { amount, symbol, decimals, ... }
  │
  ├─→ Cache balance (5-min TTL)
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
  └─→ Return Signature { signature, txHash }
```

---

## Chain Support

### Supported Chains (34+)

All chains are supported through Core's functional resolvers. The SDK has no chain-specific code.

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

**Managing Tokens:**

```typescript
// Add token
vault.addToken('Ethereum', {
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 'Ethereum'
})

// Get token balance
const balance = await vault.balance('Ethereum', '0xA0b86991...')
```

---

## Feature Status

### ✅ Implemented

#### Vault Lifecycle
- Create fast vault (2-of-2 with VultiServer)
- Import vault from .vult file
- Export vault to file (with optional encryption)
- List all vaults
- Delete vault
- Rename vault

#### Address Operations
- Single chain: `address(chain)`
- Multiple chains: `addresses(chains)`
- Permanent caching
- All 34+ chains supported

#### Balance Operations
- Native balance: `balance(chain)`
- Token balance: `balance(chain, tokenId)`
- Batch balances: `balances(chains, includeTokens)`
- Force refresh: `updateBalance(chain)`
- 5-minute TTL caching
- ERC-20, SPL, wasm token support

#### Gas Estimation
- `gas(chain)` for all chain types
- EVM: maxFeePerGas, priorityFee, gasPriceGwei
- UTXO: fee per byte
- Cosmos: gas price
- Chain-specific formatting

#### Fast Signing
- 2-of-2 MPC with VultiServer
- Server coordination via API
- WebSocket message relay
- All 34+ chains supported

#### Chain Management
- Set chains: `setChains(chains)`
- Add/remove: `addChain()`, `removeChain()`
- Get active: `getChains()`
- Reset: `resetToDefaultChains()`

#### Token Management
- Set tokens: `setTokens(chain, tokens)`
- Add/remove: `addToken()`, `removeToken()`
- Get tokens: `getTokens(chain)`

#### Address Book
- Global address book
- Add/remove/update entries
- Chain-filtered retrieval

#### Validation
- Email format validation
- Password strength (8+ chars, mixed case, numbers/symbols)
- Vault name validation (2-50 chars)

### ⏳ Partially Implemented

#### Signing
- ✅ Fast signing (server-assisted)
- ❌ Relay signing (multi-device) - Not implemented
- ❌ Local signing (single device) - Not implemented

### ❌ Not Implemented

#### Swap Functionality
Core has full swap support (THORChain, Maya, 1inch, Kyber, Lifi), but SDK integration is needed:
- Get swap quote: `getSwapQuote(params)`
- Execute swap: `swap(params)`
- Get swap-enabled chains
- Check swap support

#### Secure Vault Creation
- Multi-device vault creation (m-of-n threshold)
- Device-to-device key generation
- Backup key shard distribution

#### Relay Signing
- Multi-device signing coordination
- Message relay via WebSocket
- Local keysign participation
- Signature assembly from m-of-n devices

---

## Remaining Work

### Priority 1: Swap Integration

**Estimated:** 4-6 hours

**Goal:** Expose Core's swap functionality through Vault API.

**Tasks:**
- Create `types/Swap.ts`
- Add Vault methods: `getSwapQuote()`, `swap()`, `getSwapEnabledChains()`
- Create `adapters/buildSwapKeysignPayload.ts`
- Add swap error codes

**Core Functions Available:**
```typescript
import { findSwapQuote } from '@core/chain/swap/quote/findSwapQuote'
import { getSwapKeysignPayloadFields } from '@core/chain/swap/keysign/getSwapKeysignPayloadFields'
import { swapEnabledChains } from '@core/chain/swap/swapEnabledChains'
```

### Priority 2: Secure Vault & Relay Signing

**Estimated:** 12-16 hours

**Goal:** Enable multi-device vault creation and signing.

**Tasks:**
- Implement `createSecureVault()` with multi-device DKG
- Implement `signRelay()` for multi-device signing
- Add relay service management
- Device discovery and coordination

### Priority 3: Comprehensive Testing

**Estimated:** 8-12 hours

**Goal:** Achieve >80% test coverage.

**Test Suites:**
- Address derivation (all 34 chains)
- Balance fetching (native + tokens)
- Gas estimation (all chain types)
- Caching behavior
- Signing flows
- Vault management
- Error handling

### Priority 4: Code Cleanup

**Estimated:** 4-6 hours

**Tasks:**
- Remove redundant `ChainConfig.ts` (use Core's `chainFeeCoin` directly)
- Remove unused `crypto/index.ts` and `mpc/MPCManager.ts`
- Replace `any` types with proper types
- Enable strict TypeScript checking

See: `docs/architecture/REDUNDANT_CODE_REMOVAL_PLAN.md`

---

## Development Guide

### Adding a New Feature

1. **Check Core Support**
   - Browse `packages/core/src/`
   - Look for resolver functions
   - Confirm chain support

2. **Add Types** (if needed)
   - Create file in `types/`
   - Export from `types/index.ts`
   - Keep aligned with Core types

3. **Create Adapter** (if needed)
   - Add to `vault/adapters/`
   - Pure function, no business logic
   - Format Core output → SDK type

4. **Add Method to Vault**
   - Call Core function directly
   - Use adapter for formatting
   - Add caching if appropriate
   - Handle errors

5. **Update Exports**
   - Export types from `index.ts`
   - Don't export adapters (internal)

6. **Write Tests**
   - Test all chain types
   - Test error cases
   - Test caching if applicable

7. **Document**
   - Add JSDoc comments
   - Add usage examples

### Common Patterns

#### Caching

```typescript
// Permanent cache (addresses)
const cached = this.cacheService.get<string>(key, Infinity)

// TTL cache (balances)
const cached = this.cacheService.get<Balance>(key, 5 * 60 * 1000)

// No cache (gas, signing)
// Just call Core directly
```

#### Error Handling

```typescript
try {
  const result = await coreFunction(...)
  return result
} catch (error) {
  throw new VaultError(
    VaultErrorCode.OperationFailed,
    `Failed to ${operation}: ${chain}`,
    error as Error
  )
}
```

#### Parallel Operations

```typescript
// ✅ Good: Parallel
const addresses = await Promise.all(
  chains.map(chain => vault.address(chain))
)

// ❌ Bad: Sequential
for (const chain of chains) {
  await vault.address(chain) // Slow!
}
```

### Debugging Tips

**Enable verbose logging:**
```typescript
console.log('[Vault] balance() called', { chain, tokenId })
```

**Check cache state:**
```typescript
const cacheService = vault['cacheService']
console.log('Cache keys:', cacheService['cache'].keys())
```

**Test Core functions directly:**
```typescript
import { getCoinBalance } from '@core/chain/coin/balance'

const balance = await getCoinBalance({
  chain: Chain.Ethereum,
  address: '0x...'
})
```

### Performance Considerations

**Caching Strategy:**
- Addresses: Never expire (immutable)
- Balances: 5-minute TTL (changes frequently)
- Gas: Not cached (highly volatile)

**WASM Loading:**
- WalletCore: Loaded on first address derivation (~500ms)
- DKLS/Schnorr: Loaded on first signing (~800ms)
- Subsequent calls are instant (memoized)

**Parallel Derivation:**
- Always use `Promise.all()` for multiple chains
- Don't block on sequential operations

---

## Appendix

### Key Metrics

| Metric | Value |
|--------|-------|
| Lines of Code | ~2,500 |
| Abstraction Layers | 2 (Vault → Core) |
| Chains Supported | 34+ |
| Token Standards | ERC-20, SPL, wasm |
| Average Method Size | ~30 lines |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@trustwallet/wallet-core` | Address derivation |
| `@vultisig/core` | Blockchain logic |
| DKLS WASM | ECDSA MPC signing |
| Schnorr WASM | EdDSA MPC signing |

---

**Last Updated:** November 2025
**Status:** Production Ready
