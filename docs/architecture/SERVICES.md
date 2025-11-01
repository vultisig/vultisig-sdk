# SDK Service Layer

**Last Updated:** 2025-11-01

---

## Overview

The Vultisig SDK uses a **Service-Oriented Architecture** where the `Vault` class delegates operations to specialized services. This design provides:

- **Separation of Concerns** - Each service handles a specific domain
- **Testability** - Services can be tested independently
- **Reusability** - Services can be shared across vault instances
- **Dependency Injection** - Services are injected, not created by Vault

---

## Service Architecture

```
Vault
  ├── AddressService       - Address derivation
  ├── BalanceService       - Balance fetching (with Blockchair)
  ├── SigningService       - Transaction parsing and validation
  ├── FastSigningService   - Server-assisted signing
  └── CacheService         - TTL-based caching
```

Each service coordinates with **Chain Strategies** for chain-specific operations.

---

## Service Injection Pattern

Services are created by `VaultManager` and injected into `Vault` instances:

```typescript
// VaultManager creates services
private createVaultServices(): VaultServices {
  const strategyFactory = createDefaultStrategyFactory(this.wasmManager)

  return {
    addressService: new AddressService(strategyFactory),
    balanceService: new BalanceService(strategyFactory, blockchairFirstResolver),
    signingService: new SigningService(strategyFactory),
    fastSigningService: new FastSigningService(this.serverManager, strategyFactory)
  }
}

// Services injected into Vault
createVaultInstance(vaultData: Vault): VaultClass {
  return new VaultClass(
    vaultData,
    this.createVaultServices(),  // Injected services
    this.config
  )
}
```

**Benefits:**
- **No Circular Dependencies** - Vault doesn't create ServerManager
- **Easy Testing** - Inject mock services for testing
- **Shared Services** - One set of services per SDK instance (efficient)

---

## AddressService

### Overview

**Location:** [AddressService.ts](../../packages/sdk/src/vault/services/AddressService.ts)

Coordinates address derivation for all supported chains.

### Responsibilities

- Delegate address derivation to chain strategies
- Batch address derivation for multiple chains
- Error handling for unsupported chains

### Key Methods

```typescript
async deriveAddress(vault: Vault, chain: string): Promise<string>
async deriveAddresses(vault: Vault, chains: string[]): Promise<Record<string, string>>
```

### Implementation

```typescript
async deriveAddress(vault: Vault, chain: string): Promise<string> {
  // Get chain strategy
  const strategy = this.strategyFactory.getStrategy(chain)

  // Delegate to strategy
  return await strategy.deriveAddress(vault)
}

async deriveAddresses(vault: Vault, chains: string[]): Promise<Record<string, string>> {
  // Parallel derivation for performance
  const results = await Promise.all(
    chains.map(async (chain) => ({
      chain,
      address: await this.deriveAddress(vault, chain)
    }))
  )

  return Object.fromEntries(results.map(r => [r.chain, r.address]))
}
```

### Usage in Vault

```typescript
async address(chain: string): Promise<string> {
  // Check permanent cache
  const cached = this.addressCache.get(chain)
  if (cached) return cached

  // Derive via AddressService
  const address = await this.services.addressService.deriveAddress(this.data, chain)

  // Cache permanently (addresses never change)
  this.addressCache.set(chain, address)
  return address
}
```

---

## BalanceService

### Overview

**Location:** [BalanceService.ts](../../packages/sdk/src/vault/services/BalanceService.ts)

Coordinates balance fetching with intelligent data source selection (Blockchair vs RPC).

### Responsibilities

- Coordinate balance fetching via SmartBalanceResolver
- Delegate to Blockchair or RPC based on configuration
- Type conversion (bigint to Balance)
- Batch balance operations
- Chain metadata integration

### Key Methods

```typescript
async getBalance(vault: Vault, chain: string, tokenId?: string): Promise<bigint>
async getBalances(vault: Vault, chains: string[]): Promise<Record<string, bigint>>
```

### Smart Resolver Integration

The `BalanceService` uses a **SmartBalanceResolver** for intelligent data source selection:

```typescript
class BalanceService {
  constructor(
    private strategyFactory: ChainStrategyFactory,
    private resolver: SmartBalanceResolver  // Injected resolver
  ) {}

  async getBalance(vault: Vault, chain: string, tokenId?: string): Promise<bigint> {
    const address = await this.deriveAddress(vault, chain)

    // SmartBalanceResolver handles Blockchair vs RPC selection
    return await this.resolver.getBalance({
      chain: ChainConfig.getChainEnum(chain),
      address,
      token: tokenId
    })
  }
}
```

### Blockchair Smart Resolver

**Location:** [blockchair/integration.ts](../../packages/sdk/src/vault/balance/blockchair/integration.ts)

The SDK includes a comprehensive **Smart Resolver** system:

#### SmartBalanceResolver

Intelligently switches between Blockchair and RPC:

```typescript
class SmartBalanceResolver {
  async getBalance(input: ChainAccount): Promise<bigint> {
    // 1. Check if Blockchair is enabled and chain is supported
    if (shouldUseBlockchair(input.chain)) {
      try {
        return await this.getBlockchairBalance(input)
      } catch (error) {
        // 2. Automatic fallback to RPC on error
        if (this.config.fallbackToRpc) {
          return await getCoinBalance(input)  // Standard RPC
        }
        throw error
      }
    }

    // 3. Use RPC directly for unsupported chains
    return await getCoinBalance(input)
  }
}
```

#### Supported Chains (18+)

- **EVM (11 chains):** Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Avalanche, Blast, zkSync, Cronos, Mantle
- **UTXO (6 chains):** Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash, Zcash
- **Other (2 chains):** Solana, Cardano

#### Configuration Options

```typescript
// Pre-configured resolvers:

// 1. Blockchair-first with RPC fallback (DEFAULT)
export const blockchairFirstResolver = createSmartBalanceResolver({
  enabled: true,
  fallbackToRpc: true
})

// 2. RPC-only (disable Blockchair)
export const rpcOnlyResolver = createSmartBalanceResolver({
  enabled: false
})

// 3. Selective Blockchair (per-chain configuration)
export const selectiveBlockchairResolver = createSmartBalanceResolver({
  enabled: true,
  chainOverrides: {
    [Chain.Ethereum]: 'blockchair',
    [Chain.Bitcoin]: 'blockchair',
    [Chain.Solana]: 'rpc',  // Force RPC for Solana
  },
  fallbackToRpc: true
})
```

#### Chain-Specific Resolvers

The smart resolver delegates to chain-specific implementations:

**EVM Resolver** ([evm.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/evm.ts))
- Handles all EVM chains (Ethereum, Arbitrum, Polygon, etc.)
- Native balance and ERC-20 token support
- Blockchair API integration

**Solana Resolver** ([solana.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/solana.ts))
- Solana native SOL balance
- SPL token support
- Blockchair API integration

**Cardano Resolver** ([cardano.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/cardano.ts))
- Cardano ADA balance
- Blockchair API integration

**Transaction Resolver** ([transaction.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/transaction.ts))
- Transaction lookups via Blockchair
- Cross-chain transaction queries

#### Performance Benefits

- **5-10x Faster:** Blockchair's indexed data is significantly faster than RPC
- **Reduced RPC Load:** Fewer direct node requests
- **Better Reliability:** Automatic fallback ensures uptime
- **Built-in Caching:** Blockchair's HTTP caching reduces latency

#### Custom Configuration

You can create custom resolver configurations:

```typescript
const customResolver = createSmartBalanceResolver({
  enabled: true,
  fallbackToRpc: true,
  chainOverrides: {
    // Use Blockchair for these chains
    [Chain.Ethereum]: 'blockchair',
    [Chain.Bitcoin]: 'blockchair',

    // Force RPC for these chains
    [Chain.Avalanche]: 'rpc',
  }
})

const balanceService = new BalanceService(strategyFactory, customResolver)
```

### Usage in Vault

```typescript
async balance(chain: string, tokenId?: string): Promise<Balance> {
  const cacheKey = `${chain}:${tokenId ?? 'native'}`

  // Use CacheService with 5-minute TTL
  return await this.cacheService.getOrCompute(
    cacheKey,
    async () => {
      // Fetch via BalanceService (uses SmartBalanceResolver)
      const bigintBalance = await this.services.balanceService.getBalance(
        this.data,
        chain,
        tokenId
      )

      // Convert to Balance type with metadata
      return {
        value: bigintBalance.toString(),
        decimals: ChainConfig.getDecimals(chain),
        symbol: ChainConfig.getSymbol(chain)
      }
    },
    5 * 60 * 1000  // 5-minute TTL
  )
}
```

---

## SigningService

### Overview

**Location:** [SigningService.ts](../../packages/sdk/src/vault/services/SigningService.ts)

Coordinates transaction parsing, validation, and keysign payload building.

### Responsibilities

- Parse raw transactions via chain strategies
- Build keysign payloads for MPC signing
- Validate transaction data
- Coordinate gas estimation

### Key Methods

```typescript
async parseTransaction(chain: string, rawTx: string): Promise<ParsedTransaction>
async buildKeysignPayload(chain: string, tx: ParsedTransaction, vault: Vault): Promise<KeysignPayload>
async estimateGas(chain: string, tx: ParsedTransaction): Promise<GasEstimate>
```

### Transaction Parsing

Different chains have different transaction formats:

**EVM Chains:**
```typescript
// Parse EVM transaction (RLP-encoded)
const parsed = await signingService.parseTransaction('Ethereum', rawTx)

// ParsedEvmTransaction
{
  type: 'evm',
  from: '0x...',
  to: '0x...',
  value: '1000000000000000000',  // 1 ETH in wei
  data: '0x...',
  gasLimit: '21000',
  maxFeePerGas: '50000000000',   // EIP-1559
  maxPriorityFeePerGas: '2000000000',
  nonce: 5,
  chainId: 1
}
```

**UTXO Chains:**
```typescript
// Parse Bitcoin PSBT
const parsed = await signingService.parseTransaction('Bitcoin', psbtBase64)

// ParsedUtxoTransaction
{
  type: 'utxo',
  inputs: [
    { txid: '...', vout: 0, value: '100000', address: 'bc1q...' }
  ],
  outputs: [
    { address: 'bc1q...', value: '50000' },
    { address: 'bc1q...', value: '49000' }  // Change
  ],
  fee: '1000',
  psbt: '...'
}
```

**Solana:**
```typescript
// Parse Solana transaction
const parsed = await signingService.parseTransaction('Solana', base64Tx)

// ParsedSolanaTransaction
{
  type: 'solana',
  from: '...',
  to: '...',
  value: '1000000000',  // 1 SOL in lamports
  recentBlockhash: '...',
  instructions: [...]
}
```

### Keysign Payload Building

The service builds MPC keysign payloads from parsed transactions:

```typescript
async buildKeysignPayload(
  chain: string,
  tx: ParsedTransaction,
  vault: Vault
): Promise<KeysignPayload> {
  const strategy = this.strategyFactory.getStrategy(chain)

  // Delegate to strategy for chain-specific payload
  return await strategy.buildKeysignPayload(tx, vault.publicKeys.ecdsa)
}
```

### Gas Estimation

For chains that support it (EVM):

```typescript
async estimateGas(chain: string, tx: ParsedTransaction): Promise<GasEstimate> {
  const strategy = this.strategyFactory.getStrategy(chain)

  if (!strategy.estimateGas) {
    throw new Error(`Gas estimation not supported for ${chain}`)
  }

  return await strategy.estimateGas(tx)
}
```

### Usage in Vault

```typescript
async sign(mode: 'fast' | 'relay' | 'local', rawTx: string, password?: string) {
  // Parse transaction via SigningService
  const parsed = await this.services.signingService.parseTransaction(
    this.activeChain,
    rawTx
  )

  // Build keysign payload
  const payload = await this.services.signingService.buildKeysignPayload(
    this.activeChain,
    parsed,
    this.data
  )

  // Sign based on mode
  if (mode === 'fast') {
    return await this.services.fastSigningService.coordinateFastSigning(...)
  } else {
    // Relay or local signing
    return await this.mpcSign(payload, password)
  }
}
```

---

## FastSigningService

### Overview

**Location:** [FastSigningService.ts](../../packages/sdk/src/vault/services/FastSigningService.ts)

Coordinates server-assisted signing for fast vaults (2-of-2 with VultiServer).

### Responsibilities

- Validate vault has server signer
- Compute pre-signing hashes via strategies
- Coordinate signing with ServerManager
- Format signature results

### Key Methods

```typescript
async coordinateFastSigning(options: FastSigningOptions): Promise<Signature>
```

### Fast Signing Flow

```
1. Validate vault type (must be fast vault)
   ↓
2. Get chain strategy
   ↓
3. Initialize WalletCore
   ↓
4. Compute pre-signing hashes (via strategy)
   ↓
5. Coordinate with ServerManager
   ↓
6. Format signature result (via strategy)
   ↓
7. Return signed transaction
```

### Two-Step Fast Signing

The service implements a **two-step signing process** matching the extension:

**Step 1: Create Signing Request**
```typescript
// Call FastVault API with transaction hashes
const response = await fetch('/vault/fast-signing', {
  method: 'POST',
  body: JSON.stringify({
    vaultId: vault.publicKeys.ecdsa,
    messages: hashes,  // Pre-computed hashes
    sessionId,
    encryptionKeyHex
  })
})
```

**Step 2: Join Relay and Perform MPC**
```typescript
// Join relay session
await relayClient.joinSession(sessionId)

// Register server participant
await relayClient.registerParticipant('Server-' + vaultId)

// Wait for server to join
await waitForServerJoin()

// Perform MPC keysign
const signatures = await mpcKeysign(messages, localKeyshare)

// Format via strategy
return await strategy.formatSignatureResult(signatures, payload)
```

### Multi-Message Signing

For UTXO chains, fast signing supports multiple messages:

```typescript
// Bitcoin transaction with 3 inputs
const payload = {
  messages: [
    'hash1',  // Input 0
    'hash2',  // Input 1
    'hash3'   // Input 2
  ],
  utxoSpecific: { /* UTXO data */ }
}

// FastSigningService signs all messages
const result = await fastSigningService.coordinateFastSigning({
  vault,
  payload,
  chain: 'Bitcoin'
})

// Result includes all signatures
result.signatures = ['sig1', 'sig2', 'sig3']
```

### Server Validation

The service validates vault configuration before signing:

```typescript
async coordinateFastSigning(options: FastSigningOptions) {
  // Validate vault has server signer
  const hasServerSigner = options.vault.signers.some(
    signer => signer.startsWith('Server-')
  )

  if (!hasServerSigner) {
    throw new Error('Fast signing requires a vault with server signer')
  }

  // Proceed with signing...
}
```

### Usage in Vault

```typescript
async sign(mode: 'fast' | 'relay' | 'local', rawTx: string, password?: string) {
  if (mode === 'fast') {
    // Use FastSigningService
    return await this.services.fastSigningService.coordinateFastSigning({
      vault: this.data,
      payload,
      chain: this.activeChain,
      password
    })
  }

  // Handle other modes...
}
```

---

## CacheService

### Overview

**Location:** [CacheService.ts](../../packages/sdk/src/vault/services/CacheService.ts)

Provides TTL-based caching for frequently accessed data.

### Responsibilities

- Store cached values with expiration
- Get-or-compute pattern (fetch if missing/expired)
- Manual cache invalidation
- Generic type support

### Key Methods

```typescript
async getOrCompute<T>(
  key: string,
  compute: () => Promise<T>,
  ttl: number
): Promise<T>

set<T>(key: string, value: T, ttl: number): void
get<T>(key: string): T | undefined
clear(key?: string): void
```

### Implementation

```typescript
class CacheService {
  private cache = new Map<string, { value: any; expiresAt: number }>()

  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    const cached = this.cache.get(key)

    // Return cached value if valid
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T
    }

    // Compute new value
    const value = await compute()

    // Store with TTL
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    })

    return value
  }

  clear(key?: string): void {
    if (key) {
      this.cache.delete(key)
    } else {
      this.cache.clear()
    }
  }
}
```

### Usage Examples

**Balance Caching (5-minute TTL):**
```typescript
const balance = await cacheService.getOrCompute(
  'Ethereum:native',
  async () => await fetchBalance('Ethereum'),
  5 * 60 * 1000  // 5 minutes
)
```

**Manual Invalidation:**
```typescript
// Force refresh balance
cacheService.clear('Ethereum:native')
const freshBalance = await vault.balance('Ethereum')
```

**Clear All Cache:**
```typescript
// Clear all cached balances
cacheService.clear()
```

---

## Service Configuration

Services are configured in `VaultManager`:

```typescript
private createVaultServices(): VaultServices {
  const strategyFactory = createDefaultStrategyFactory(this.wasmManager)

  return {
    // Address derivation
    addressService: new AddressService(strategyFactory),

    // Balance fetching with Blockchair-first resolver
    balanceService: new BalanceService(
      strategyFactory,
      blockchairFirstResolver  // Smart resolver
    ),

    // Transaction parsing and validation
    signingService: new SigningService(strategyFactory),

    // Server-assisted signing (optional)
    fastSigningService: new FastSigningService(
      this.serverManager,
      strategyFactory
    )
  }
}
```

### Custom Service Configuration

For advanced use cases, you can customize services:

```typescript
// Custom balance resolver (RPC-only)
const balanceService = new BalanceService(
  strategyFactory,
  rpcOnlyResolver  // Disable Blockchair
)

// Custom services
const customServices: VaultServices = {
  addressService: new AddressService(strategyFactory),
  balanceService,  // Custom resolver
  signingService: new SigningService(strategyFactory),
  fastSigningService: undefined  // Disable fast signing
}
```

---

## Service Benefits

### 1. Separation of Concerns
Each service has a single, well-defined responsibility:
- **AddressService** - Address derivation only
- **BalanceService** - Balance fetching only
- **SigningService** - Transaction parsing only
- **FastSigningService** - Server-assisted signing only
- **CacheService** - Caching only

### 2. Testability
Services can be tested independently:
```typescript
// Test AddressService with mock strategy
const mockStrategy = new MockChainStrategy()
const strategyFactory = new ChainStrategyFactory()
strategyFactory.register('Ethereum', mockStrategy)

const addressService = new AddressService(strategyFactory)
const address = await addressService.deriveAddress(vault, 'Ethereum')

expect(address).toBe(mockStrategy.expectedAddress)
```

### 3. Reusability
Services are shared across vault instances:
```typescript
// One set of services for all vaults
const services = vaultManager.createVaultServices()

const vault1 = new VaultClass(vaultData1, services, config)
const vault2 = new VaultClass(vaultData2, services, config)

// Both vaults use same services (efficient)
```

### 4. Composability
Services can be composed and customized:
```typescript
// Wrap BalanceService with logging
class LoggingBalanceService extends BalanceService {
  async getBalance(...args) {
    console.log('Fetching balance...')
    const result = await super.getBalance(...args)
    console.log('Balance:', result)
    return result
  }
}
```

### 5. Dependency Injection
Services enable clean dependency injection:
```typescript
// Vault receives services, doesn't create them
class VaultClass {
  constructor(
    public data: Vault,
    private services: VaultServices,  // Injected
    private config: VaultConfig
  ) {}

  async balance(chain: string) {
    // Use injected service
    return await this.services.balanceService.getBalance(...)
  }
}
```

---

## Summary

The **Service Layer** provides:

1. **Clean Architecture** - Clear separation of concerns
2. **Testability** - Each service testable in isolation
3. **Flexibility** - Easy to customize and extend
4. **Performance** - Smart resolvers, caching, batch operations
5. **Maintainability** - Well-defined contracts and responsibilities

For more information, see:
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall SDK architecture
- [MANAGERS.md](./MANAGERS.md) - Manager pattern documentation
- [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) - Chain configuration system
