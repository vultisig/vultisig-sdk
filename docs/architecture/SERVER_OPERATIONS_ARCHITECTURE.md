# Server Operations Architecture

**Date:** 2025-10-28
**Status:** Comprehensive Guide
**Version:** 1.0

---

## Executive Summary

This document provides a comprehensive analysis of ServerManager and fast vault operations in the Vultisig SDK. It covers the current implementation, identifies architectural issues, proposes refactoring solutions, and provides detailed implementation guidance.

**Key Topics:**
- ServerManager current implementation and responsibilities
- Fast Vault architecture (2-of-2 threshold signing with VultiServer)
- Architectural issues and proposed refactoring
- Integration with service layer and strategy pattern
- Implementation guide and testing strategy

---

## Table of Contents

1. [ServerManager Overview](#servermanager-overview)
2. [Fast Vault Architecture](#fast-vault-architecture)
3. [Current Implementation Analysis](#current-implementation-analysis)
4. [Architectural Issues](#architectural-issues)
5. [Refactoring Proposal](#refactoring-proposal)
6. [Implementation Guide](#implementation-guide)
7. [Integration with Service Layer](#integration-with-service-layer)
8. [Testing Strategy](#testing-strategy)
9. [Migration Path](#migration-path)

---

## ServerManager Overview

### Purpose

ServerManager coordinates all server communication for Fast Vault operations, enabling 2-of-2 threshold signing between a user's device and VultiServer.

### Location

**File:** `packages/sdk/src/server/ServerManager.ts`
**Lines of Code:** 641 lines (current implementation)

### Key Responsibilities

1. **Fast Vault Creation**
   - Coordinate keygen with VultiServer
   - Generate ECDSA and EdDSA key shares
   - Create 2-of-2 threshold vault

2. **Fast Vault Verification**
   - Verify email codes
   - Resend verification emails
   - Retrieve vaults from server

3. **Fast Signing**
   - Coordinate MPC signing with VultiServer
   - Compute message hashes for signing
   - Format signature results

4. **Server Status**
   - Check FastVault API connectivity
   - Check message relay connectivity

### Configuration

```typescript
constructor(endpoints?: {
  fastVault?: string      // Default: 'https://api.vultisig.com/vault'
  messageRelay?: string   // Default: 'https://api.vultisig.com/router'
})
```

### Public Methods (Current)

```typescript
class ServerManager {
  // Fast vault operations
  async createFastVault(options: {...}): Promise<{vault: Vault, vaultId: string, verificationRequired: boolean}>
  async reshareVault(vault: Vault, options: ReshareOptions): Promise<Vault>

  // Vault verification
  async verifyVault(vaultId: string, code: string): Promise<boolean>
  async resendVaultVerification(vaultId: string): Promise<void>
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault>

  // Fast signing
  async signWithServer(vault: any, payload: SigningPayload, password: string): Promise<Signature>

  // Status
  async checkServerStatus(): Promise<ServerStatus>

  // Private helpers
  private async waitForPeers(sessionId: string, localPartyId: string): Promise<string[]>
  private async computeMessageHashesFromTransaction(payload, walletCore, chain, vault): Promise<string[]>
}
```

---

## Fast Vault Architecture

### What is a Fast Vault?

A Fast Vault uses **2-of-2 threshold signing** between:
1. **User Device** - Holds one key share
2. **VultiServer** - Holds the second key share

**Both parties required:** Transactions require signatures from both the user's device and VultiServer to be valid.

### Fast Vault vs Regular Vault

| Feature | Fast Vault | Regular Vault |
|---------|-----------|---------------|
| **Participants** | 2 (Device + Server) | N devices |
| **Threshold** | 2-of-2 | Configurable (e.g., 2-of-3) |
| **Speed** | ⚡ Fast (server available 24/7) | Slower (requires coordinating devices) |
| **Availability** | High (server always online) | Medium (requires multiple devices) |
| **Use Case** | Quick transactions, mobile-first | High security, multi-device setups |

### Fast Signing Flow

```
┌─────────────┐                    ┌──────────────┐
│    User     │                    │  VultiServer │
│   Device    │                    │              │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │  1. Compute message hash         │
       │     (chain-specific)             │
       │                                  │
       │  2. Call FastVault API          │
       │─────────────────────────────────>│
       │     (session ID, messages)       │
       │                                  │
       │  3. Join relay session           │
       │─────────────────────────────────>│
       │     (MPC coordination)           │
       │                                  │
       │  4. Wait for peers               │
       │<─────────────────────────────────│
       │     (server joins session)       │
       │                                  │
       │  5. Start MPC session            │
       │─────────────────────────────────>│
       │     (devices list)               │
       │                                  │
       │  6. Perform MPC keysign          │
       │<────────────────────────────────>│
       │     (threshold signing)          │
       │                                  │
       │  7. Format signature             │
       │     (chain-specific)             │
       │                                  │
       └──────────────────────────────────┘
```

### VultiServer Endpoints

1. **FastVault API** (`https://api.vultisig.com/vault`)
   - Vault creation
   - Email verification
   - Vault retrieval
   - Signing coordination

2. **Message Relay** (`https://api.vultisig.com/router`)
   - MPC message passing
   - Session coordination
   - Peer discovery

---

## Current Implementation Analysis

### File Structure

```
packages/sdk/src/server/
├── ServerManager.ts         # Main server coordination (641 lines)
├── utils.ts                 # Utility functions (party IDs, encryption keys)
└── index.ts                 # Exports (currently exports everything)
```

### Key Methods Deep Dive

#### 1. `signWithServer()` - 240 Lines

**Current Implementation (Lines 75-316):**

```typescript
async signWithServer(
  vault: any,
  payload: SigningPayload,
  vaultPassword: string
): Promise<Signature> {
  // Validation (10 lines)
  const hasFastVaultServer = vault.signers.some(signer => signer.startsWith('Server-'))
  if (!hasFastVaultServer) throw new Error('...')

  // Initialization (15 lines)
  const walletCore = await initWasm()
  const addressDeriver = new AddressDeriver()
  await addressDeriver.initialize(walletCore)
  const chain = addressDeriver.mapStringToChain(payload.chain)

  // Chain-specific logic (85 lines)
  let messages: string[]
  if (payload.messageHashes) {
    messages = payload.messageHashes
  } else {
    messages = await this.computeMessageHashesFromTransaction(
      payload, walletCore, chain, vault
    )
  }

  // Server coordination (100 lines)
  const sessionId = generateSessionId()
  const hexEncryptionKey = await generateEncryptionKey()
  const signingLocalPartyId = generateLocalPartyId('extension' as any)

  await callFastVaultAPI({ sessionId, messages, vault, password })
  await joinMpcSession({ serverUrl, sessionId, localPartyId })

  const devices = await this.waitForPeers(sessionId, signingLocalPartyId)
  await startMpcSession({ serverUrl, sessionId, devices })

  // MPC signing (30 lines)
  const signatureResults: Record<string, any> = {}
  for (const msg of messages) {
    const sig = await keysign({ message: msg, ... })
    signatureResults[msg] = sig
  }

  // Chain-specific result formatting (25 lines)
  if (!isUtxo) {
    // EVM formatting
    return { signature: sigResult.der_signature, format: 'ECDSA', recovery: recoveryId }
  } else {
    // UTXO transaction compilation
    const compiledTxs = inputs.map(txInputData => compileTx({ ... }))
    return { signature: finalTxHex, format: 'DER' }
  }
}
```

**Breakdown by Concern:**
- **Validation:** 10 lines
- **Initialization:** 15 lines
- **Chain Logic:** 85 lines ⚠️ (should be in ChainStrategy)
- **Server Coordination:** 100 lines ✅ (core responsibility)
- **MPC Signing:** 30 lines ✅ (core responsibility)
- **Chain Formatting:** 25 lines ⚠️ (should be in ChainStrategy)

**Total:** 240 lines (110 lines should be extracted)

---

#### 2. `computeMessageHashesFromTransaction()` - 85 Lines

**Current Implementation (Lines 555-639):**

```typescript
private async computeMessageHashesFromTransaction(
  payload: SigningPayload,
  walletCore: any,
  chain: any,
  vault: any
): Promise<string[]> {
  const network = String(payload.chain || '').toLowerCase()

  // EVM-specific logic (18 lines)
  if (network === 'ethereum' || network === 'eth') {
    const { serializeTransaction, keccak256 } = await import('viem')
    const tx = payload.transaction
    const unsigned = {
      type: 'eip1559' as const,
      chainId: tx.chainId,
      to: tx.to as `0x${string}`,
      nonce: tx.nonce,
      gas: BigInt(tx.gasLimit),
      data: (tx.data || '0x') as `0x${string}`,
      value: BigInt(tx.value),
      maxFeePerGas: BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? '0'),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas ?? '0'),
      accessList: [],
    }
    const serialized = serializeTransaction(unsigned)
    const signingHash = keccak256(serialized).slice(2)
    return [signingHash]
  }

  // Bitcoin-specific logic (50 lines)
  if (network === 'bitcoin' || network === 'btc') {
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import('@core/mpc/types/...')
    const { getTxInputData } = await import('@core/mpc/keysign/txInputData')
    const { getPreSigningHashes } = await import('@core/chain/tx/preSigningHashes')

    const publicKey = getPublicKey({ chain, walletCore, ... })
    const address = deriveAddress({ chain, publicKey, walletCore })
    const psbtBase64 = payload.transaction?.psbtBase64

    if (!psbtBase64) throw new Error('BTC signing requires transaction.psbtBase64')

    const keysignPayload = create(KeysignPayloadSchema, { ... })
    const inputs = getTxInputData({ keysignPayload, walletCore, publicKey })
    const hashes = inputs
      .flatMap(txInputData => getPreSigningHashes({ walletCore, chain, txInputData }))
      .map(value => Buffer.from(value).toString('hex'))

    return hashes
  }

  // Solana-specific logic (not implemented)
  if (network === 'solana' || network === 'sol') {
    // TODO: implement Solana message hash computation
  }

  throw new Error(`Message hash computation not yet implemented for chain: ${payload.chain}`)
}
```

**Issues:**
- ❌ Chain-specific logic in ServerManager (should be in ChainStrategy)
- ❌ Direct imports of chain utilities (viem, protobuf)
- ❌ Switch statement on chain type (violates strategy pattern)
- ❌ Cannot easily add new chains (must modify ServerManager)
- ❌ Cannot test server coordination separately from chain logic

---

### Usage in Codebase

#### VultisigSDK.ts

```typescript
class Vultisig {
  private serverManager: ServerManager

  constructor(config?: VultisigConfig) {
    this.serverManager = new ServerManager({
      fastVault: config?.serverEndpoints?.fastVault,
      messageRelay: config?.serverEndpoints?.messageRelay,
    })
  }

  // ⚠️ Public getter exposes internal implementation
  getServerManager(): ServerManager {
    return this.serverManager
  }

  async createFastVault(options: CreateVaultOptions): Promise<Vault> {
    return this.serverManager.createFastVault(options)
  }

  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    return this.serverManager.verifyVault(vaultId, code)
  }
}
```

#### Vault.ts

```typescript
class Vault {
  async sign(
    mode: SigningMode,
    payload: SigningPayload,
    options?: { vaultPassword?: string }
  ): Promise<Signature> {
    if (mode === 'fast') {
      // Direct usage of ServerManager
      const sdk = this._sdkInstance
      const serverManager = sdk.getServerManager()

      return serverManager.signWithServer(
        this.vaultData,
        payload,
        options?.vaultPassword || ''
      )
    }

    // ... other signing modes
  }
}
```

#### index.ts

```typescript
// ⚠️ Currently exports everything
export * from './server'  // Exports ServerManager + 20+ utility functions
```

---

## Architectural Issues

### Issue 1: Mixed Concerns

**Problem:** ServerManager combines server coordination with chain-specific logic

**Evidence:**
- `computeMessageHashesFromTransaction()` contains EVM, Bitcoin, and Solana logic
- `signWithServer()` mixes server calls with chain-specific result formatting
- Direct imports of chain libraries (viem, protobuf)

**Impact:**
- Violates Single Responsibility Principle
- Hard to test server coordination separately from chain logic
- Cannot add new chains without modifying ServerManager
- Tight coupling between server operations and chain implementations

---

### Issue 2: Over-Exposure

**Problem:** ServerManager is exported publicly when it should be internal

**Evidence:**
```typescript
// index.ts line 112
export * from './server'  // Exports ServerManager + utilities

// VultisigSDK.ts
getServerManager(): ServerManager {  // Public getter
  return this.serverManager
}
```

**Impact:**
- Users can bypass Vault and use ServerManager directly
- Creates additional public API surface to maintain
- Cannot refactor ServerManager without potential breaking changes
- Violates encapsulation principles

**Example of Misuse:**
```typescript
// Users can currently do this (bad):
import { ServerManager } from 'vultisig-sdk'
const serverManager = new ServerManager()
await serverManager.signWithServer(vault, payload, password)  // Bypasses Vault validation

// Should only be accessible via:
await vault.sign('fast', payload, password)  // Proper encapsulation
```

---

### Issue 3: Tight Coupling

**Problem:** ServerManager directly imports and uses chain-specific utilities

**Evidence:**
```typescript
// Line 97
const { AddressDeriver } = await import('../chains/AddressDeriver')
const addressDeriver = new AddressDeriver()

// Lines 562-580
const { serializeTransaction, keccak256 } = await import('viem')

// Lines 584-639
const { create } = await import('@bufbuild/protobuf')
const { KeysignPayloadSchema } = await import('@core/mpc/types/...')
```

**Impact:**
- Cannot mock chain operations for testing
- ServerManager depends on chain implementation details
- Changing chain utilities requires updating ServerManager
- Violates Dependency Inversion Principle

---

### Issue 4: Large Method Size

**Problem:** `signWithServer()` method is 240+ lines with multiple responsibilities

**Responsibilities:**
1. Vault validation
2. WalletCore initialization
3. Chain-specific hash computation
4. Server API calls
5. MPC session coordination
6. Peer management
7. MPC keysign execution
8. Chain-specific result formatting

**Impact:**
- Hard to understand and maintain
- Difficult to test individual pieces
- High cyclomatic complexity
- Violates Single Responsibility Principle

---

## Refactoring Proposal

### Goals

1. **Separate Concerns:** Server coordination vs chain logic
2. **Internal Only:** Make ServerManager internal (not exported)
3. **Strategy Pattern:** Move chain logic to ChainStrategy implementations
4. **Service Layer:** Create FastSigningService as orchestrator
5. **Testability:** Enable testing components independently

### Architecture Overview

**Before (Mixed Concerns):**
```
Vault.sign('fast', payload)
  ↓
ServerManager.signWithServer()  [240 lines]
  ├── computeMessageHashesFromTransaction()  [EVM/Bitcoin/Solana logic]
  ├── Server coordination
  ├── MPC signing
  └── Result formatting  [chain-specific]
```

**After (Separation of Concerns):**
```
Vault.sign('fast', payload)
  ↓
FastSigningService.signWithServer()  [40 lines]
  ├── ChainStrategy.computePreSigningHashes()  [chain-specific]
  ├── ServerManager.coordinateFastSigning()  [server coordination only]
  └── ChainStrategy.formatSignatureResult()  [chain-specific]
```

### Component Responsibilities

#### 1. ChainStrategy (Chain Logic)

**New Methods:**
```typescript
interface ChainStrategy {
  // Existing methods...
  deriveAddress(vault: CoreVault): Promise<string>
  getBalance(address: string): Promise<Balance>
  parseTransaction(rawTx: any): Promise<ParsedTransaction>
  buildKeysignPayload(tx: ParsedTransaction): Promise<KeysignPayload>

  // NEW: Fast vault support
  computePreSigningHashes(payload: SigningPayload, vault: Vault, walletCore: any): Promise<string[]>
  formatSignatureResult(signatureResults: Record<string, any>, payload: SigningPayload): Promise<Signature>
}
```

**Implementations:**
- `EvmStrategy.computePreSigningHashes()` - EVM transaction hashing (18 lines)
- `BitcoinStrategy.computePreSigningHashes()` - UTXO PSBT hashing (50 lines)
- `SolanaStrategy.computePreSigningHashes()` - Solana transaction hashing

---

#### 2. FastSigningService (Orchestration)

**Purpose:** Coordinate fast signing by combining ServerManager and ChainStrategy

```typescript
class FastSigningService {
  constructor(
    private serverManager: ServerManager,
    private strategyFactory: ChainStrategyFactory
  ) {}

  async signWithServer(
    vault: Vault,
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    // 1. Validate vault has server signer
    this.validateFastVault(vault)

    // 2. Get chain strategy
    const strategy = this.strategyFactory.getStrategy(payload.chain)

    // 3. Initialize WalletCore
    const walletCore = await initWasm()

    // 4. Compute message hashes (chain-specific via strategy)
    const messages = payload.messageHashes ||
      await strategy.computePreSigningHashes(payload, vault, walletCore)

    // 5. Coordinate signing with server (server coordination only)
    return this.serverManager.coordinateFastSigning({
      vault,
      messages,
      password,
      payload,
      strategy
    })
  }
}
```

**Lines:** ~40 lines (orchestration only)

---

#### 3. ServerManager (Server Coordination)

**Purpose:** Pure server coordination - no chain logic

**Refactored Method:**
```typescript
async coordinateFastSigning(options: {
  vault: Vault
  messages: string[]       // Pre-computed by ChainStrategy
  password: string
  payload: SigningPayload
  strategy: ChainStrategy  // For result formatting
}): Promise<Signature> {
  const { vault, messages, password, strategy } = options

  // Generate session parameters
  const sessionId = generateSessionId()
  const hexEncryptionKey = await generateEncryptionKey()
  const signingLocalPartyId = generateLocalPartyId('extension' as any)

  // Step 1: Call FastVault API
  await this.callFastVaultAPI({ sessionId, messages, vault, password })

  // Step 2: Join relay session
  await this.joinRelaySession(sessionId, signingLocalPartyId)

  // Step 3: Wait for peers
  const devices = await this.waitForPeers(sessionId, signingLocalPartyId)

  // Step 4: Start MPC session
  await this.startMpcSession(sessionId, devices)

  // Step 5: Perform MPC keysign
  const signatureResults = await this.performMpcKeysign({
    vault, messages, devices, sessionId, hexEncryptionKey, signingLocalPartyId
  })

  // Step 6: Format result using strategy (chain-specific)
  return strategy.formatSignatureResult(signatureResults, payload)
}
```

**Lines:** ~100 lines (server coordination only)

**Changes:**
- ❌ **Removed:** `computeMessageHashesFromTransaction()` (moved to strategies)
- ✅ **Refactored:** `signWithServer()` → `coordinateFastSigning()`
- ✅ **Takes:** Pre-computed messages and strategy
- ✅ **Returns:** Formatted signature via strategy

---

### Benefits

1. **Separation of Concerns:**
   - ServerManager = server coordination only
   - ChainStrategy = all chain-specific logic
   - FastSigningService = orchestration

2. **Testability:**
   - Test server coordination with mock strategy
   - Test chain logic without server
   - Test orchestration with mocks

3. **Extensibility:**
   - Add new chains by implementing strategy methods
   - No changes to ServerManager needed

4. **Encapsulation:**
   - ServerManager becomes internal (not exported)
   - Users access via `vault.sign('fast', ...)`

5. **Maintainability:**
   - Clear responsibilities
   - Smaller, focused methods
   - Easier to understand and modify

---

## Implementation Guide

See [ARCHITECTURE_REFACTOR_IMPLEMENTATION.md](./ARCHITECTURE_REFACTOR_IMPLEMENTATION.md) for detailed implementation steps.

### Quick Summary

**Phase 1:** Create Strategy Pattern
- Add `computePreSigningHashes()` to ChainStrategy interface
- Add `formatSignatureResult()` to ChainStrategy interface
- Implement in EvmStrategy, BitcoinStrategy, SolanaStrategy

**Phase 2:** Create FastSigningService
- Create `vault/services/FastSigningService.ts`
- Implement orchestration logic
- Export from services index

**Phase 6:** Refactor ServerManager
- Remove `computeMessageHashesFromTransaction()`
- Refactor `signWithServer()` → `coordinateFastSigning()`
- Remove from public exports
- Remove `Vultisig.getServerManager()` public method

---

## Integration with Service Layer

### Vault Integration

```typescript
class Vault {
  private fastSigningService: FastSigningService  // NEW

  constructor(
    vaultData: CoreVault,
    walletCore: WalletCore,
    serverManager: ServerManager,
    addressService: AddressService,
    balanceService: BalanceService,
    signingService: SigningService
  ) {
    // Initialize fast signing service
    this.fastSigningService = new FastSigningService(
      serverManager,
      new ChainStrategyFactory()
    )
  }

  async sign(
    mode: 'fast' | 'relay' | 'local',
    payload: SigningPayload,
    options?: { vaultPassword?: string }
  ): Promise<Signature> {
    // Fast mode: use FastSigningService
    if (mode === 'fast') {
      if (!options?.vaultPassword) {
        throw new VaultError('Vault password required for fast signing')
      }

      return this.fastSigningService.signWithServer(
        this.vaultData,
        payload,
        options.vaultPassword
      )
    }

    // Regular signing modes: use SigningService
    return this.signingService.sign(payload, mode)
  }
}
```

### Service Layer Flow

```
User Call:
vault.sign('fast', payload, { vaultPassword: 'password' })
  ↓
FastSigningService.signWithServer()
  ↓
  ├─→ ChainStrategyFactory.getStrategy('Ethereum')
  │     ↓
  │   EvmStrategy
  │
  ├─→ EvmStrategy.computePreSigningHashes()
  │     ↓
  │   ['0xabc123...']  // EVM transaction hash
  │
  ├─→ ServerManager.coordinateFastSigning()
  │     ↓
  │   1. Call FastVault API
  │   2. Join relay session
  │   3. Wait for peers
  │   4. Start MPC session
  │   5. Perform MPC keysign
  │     ↓
  │   { '0xabc123...': { der_signature: '0x...', recovery_id: '01' } }
  │
  └─→ EvmStrategy.formatSignatureResult()
        ↓
      { signature: '0x...', format: 'ECDSA', recovery: 1 }
```

---

## Testing Strategy

### 1. Unit Test ChainStrategy

**Test EVM hash computation:**
```typescript
describe('EvmStrategy.computePreSigningHashes', () => {
  it('should compute correct signing hash for EIP-1559 transaction', async () => {
    const strategy = new EvmStrategy('Ethereum')
    const payload = {
      transaction: {
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        value: '1000000000000000000',
        gasLimit: '21000',
        maxFeePerGas: '50000000000',
        maxPriorityFeePerGas: '2000000000',
        nonce: 5,
        chainId: 1,
        data: '0x',
      },
      chain: 'Ethereum',
    }

    const hashes = await strategy.computePreSigningHashes(payload, mockVault, mockWalletCore)

    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/)  // 32 bytes hex
  })
})
```

**Test signature formatting:**
```typescript
describe('EvmStrategy.formatSignatureResult', () => {
  it('should format ECDSA signature with recovery ID', async () => {
    const strategy = new EvmStrategy('Ethereum')
    const signatureResults = {
      'abc123': {
        der_signature: '0x1234567890abcdef...',
        recovery_id: '01',
      }
    }

    const result = await strategy.formatSignatureResult(signatureResults, mockPayload)

    expect(result.signature).toBe('0x1234567890abcdef...')
    expect(result.format).toBe('ECDSA')
    expect(result.recovery).toBe(1)
  })
})
```

---

### 2. Unit Test ServerManager

**Test server coordination with mock strategy:**
```typescript
describe('ServerManager.coordinateFastSigning', () => {
  let serverManager: ServerManager
  let mockStrategy: jest.Mocked<ChainStrategy>

  beforeEach(() => {
    serverManager = new ServerManager()
    mockStrategy = {
      computePreSigningHashes: jest.fn().mockResolvedValue(['hash1', 'hash2']),
      formatSignatureResult: jest.fn().mockResolvedValue({
        signature: '0xabc...',
        format: 'ECDSA',
      })
    } as any
  })

  it('should coordinate fast signing with strategy', async () => {
    const result = await serverManager.coordinateFastSigning({
      vault: mockVault,
      messages: ['hash1', 'hash2'],
      vaultPassword: 'password123',
      payload: mockPayload,
      strategy: mockStrategy,
    })

    expect(mockStrategy.formatSignatureResult).toHaveBeenCalledWith(
      expect.any(Object),
      mockPayload
    )
    expect(result.signature).toBe('0xabc...')
  })

  it('should call FastVault API with correct parameters', async () => {
    // Mock FastVault API
    const mockCallFastVaultAPI = jest.spyOn(serverManager as any, 'callFastVaultAPI')
      .mockResolvedValue('session-123')

    await serverManager.coordinateFastSigning({
      vault: mockVault,
      messages: ['hash1'],
      vaultPassword: 'password123',
      payload: mockPayload,
      strategy: mockStrategy,
    })

    expect(mockCallFastVaultAPI).toHaveBeenCalledWith({
      public_key: mockVault.publicKeys.ecdsa,
      messages: ['hash1'],
      session: expect.any(String),
      hex_encryption_key: expect.any(String),
      derive_path: expect.any(String),
      is_ecdsa: true,
      vault_password: 'password123',
    })
  })
})
```

---

### 3. Unit Test FastSigningService

**Test orchestration with mocks:**
```typescript
describe('FastSigningService', () => {
  let fastSigningService: FastSigningService
  let mockServerManager: jest.Mocked<ServerManager>
  let mockStrategyFactory: jest.Mocked<ChainStrategyFactory>
  let mockStrategy: jest.Mocked<ChainStrategy>

  beforeEach(() => {
    mockStrategy = {
      computePreSigningHashes: jest.fn().mockResolvedValue(['hash1']),
      formatSignatureResult: jest.fn().mockResolvedValue({
        signature: '0xabc...',
        format: 'ECDSA',
      })
    } as any

    mockStrategyFactory = {
      getStrategy: jest.fn().mockReturnValue(mockStrategy)
    } as any

    mockServerManager = {
      coordinateFastSigning: jest.fn().mockResolvedValue({
        signature: '0xabc...',
        format: 'ECDSA',
      })
    } as any

    fastSigningService = new FastSigningService(mockServerManager, mockStrategyFactory)
  })

  it('should orchestrate fast signing correctly', async () => {
    const result = await fastSigningService.signWithServer(
      mockVault,
      mockPayload,
      'password123'
    )

    expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('Ethereum')
    expect(mockStrategy.computePreSigningHashes).toHaveBeenCalledWith(
      mockPayload,
      mockVault,
      expect.any(Object)  // walletCore
    )
    expect(mockServerManager.coordinateFastSigning).toHaveBeenCalledWith({
      vault: mockVault,
      messages: ['hash1'],
      vaultPassword: 'password123',
      payload: mockPayload,
      strategy: mockStrategy,
    })
    expect(result.signature).toBe('0xabc...')
  })

  it('should throw error if vault does not have server signer', async () => {
    const vaultWithoutServer = { ...mockVault, signers: ['Device-abc'] }

    await expect(
      fastSigningService.signWithServer(vaultWithoutServer, mockPayload, 'password123')
    ).rejects.toThrow('Vault does not have VultiServer')
  })
})
```

---

### 4. Integration Test

**End-to-end fast signing:**
```typescript
describe('Fast Signing Integration', () => {
  it('should sign EVM transaction end-to-end', async () => {
    const sdk = new Vultisig()
    const vault = await sdk.getVault('my-vault', 'password')

    const signature = await vault.sign('fast', {
      transaction: {
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        value: '1000000000000000000',
        gasLimit: '21000',
        maxFeePerGas: '50000000000',
        maxPriorityFeePerGas: '2000000000',
        nonce: 5,
        chainId: 1,
        data: '0x',
      },
      chain: 'Ethereum',
    }, { vaultPassword: 'vault-password' })

    expect(signature.signature).toBeDefined()
    expect(signature.format).toBe('ECDSA')
    expect(signature.recovery).toBeDefined()
  }, 30000)  // 30 second timeout for server coordination
})
```

---

## Migration Path

### Phase 1: v2.x (Transition Period)

**Goals:**
- Maintain backward compatibility
- Add deprecation warnings
- Guide users to new patterns

**Changes:**
```typescript
// index.ts
// Old exports still work but with warnings
export * from './server'  // ⚠️ Will be removed in v3.0

// VultisigSDK.ts
/**
 * @deprecated Use vault.sign('fast', ...) instead. Will be removed in v3.0.
 */
getServerManager(): ServerManager {
  console.warn('getServerManager() is deprecated. Use vault.sign("fast", ...) instead.')
  return this.serverManager
}
```

**Documentation:**
- Update docs to show new patterns
- Add migration guide
- Highlight deprecations

**Timeline:** 6-12 months for users to migrate

---

### Phase 2: v3.0 (Clean API)

**Goals:**
- Remove deprecated exports
- Clean internal architecture
- Enforce encapsulation

**Changes:**
```typescript
// index.ts
// Only export types, not ServerManager
export type { ServerStatus, KeygenProgressUpdate } from './server'

// VultisigSDK.ts
// Remove public getter
// getServerManager() method deleted

// ServerManager remains internal only
```

**Breaking Changes:**
- `ServerManager` no longer exported
- `Vultisig.getServerManager()` removed
- Users must use `vault.sign('fast', ...)`

**Migration Path:**
```typescript
// Before (v2.x):
const serverManager = sdk.getServerManager()
await serverManager.signWithServer(vault, payload, password)

// After (v3.0):
await vault.sign('fast', payload, { vaultPassword: password })
```

---

## Summary

### Key Takeaways

1. **ServerManager is Essential** for fast vault operations
2. **Current Implementation** mixes server coordination with chain logic
3. **Refactoring Goal** is separation of concerns via strategy pattern
4. **FastSigningService** orchestrates between ServerManager and ChainStrategy
5. **Testing Strategy** enables independent testing of components
6. **Migration Path** maintains backward compatibility during transition

### Documentation Links

- **Current State:** [ARCHITECTURE_CURRENT_STATE_ANALYSIS.md](./ARCHITECTURE_CURRENT_STATE_ANALYSIS.md)
- **Refactoring Proposal:** [ARCHITECTURE_REFACTOR_PROPOSAL.md](./ARCHITECTURE_REFACTOR_PROPOSAL.md)
- **Implementation Guide:** [ARCHITECTURE_REFACTOR_IMPLEMENTATION.md](./ARCHITECTURE_REFACTOR_IMPLEMENTATION.md)
- **Adding Chains:** [ADDING_NEW_CHAINS_GUIDE.md](./ADDING_NEW_CHAINS_GUIDE.md)

---

**Questions?** Open an issue or discuss with the team!

**Ready to implement?** Start with [ARCHITECTURE_REFACTOR_IMPLEMENTATION.md](./ARCHITECTURE_REFACTOR_IMPLEMENTATION.md) Phase 6!
