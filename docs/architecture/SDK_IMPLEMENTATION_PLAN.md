# SDK Implementation Plan: Functional Adapter Approach

**Last Updated:** 2025-11-03
**Status:** Planning
**Approach:** Functional adapters (no strategy pattern)

---

## Executive Decision: Why Functional Adapters?

### Core's Architecture
Core uses **functional dispatch pattern** with resolvers:
```typescript
// Core pattern (packages/core/)
const resolvers: Record<ChainKind, Resolver> = { evm, cosmos, utxo, ... }
export const getCoinBalance = async (input) =>
  resolvers[getChainKind(input.chain)](input)
```

### Initial SDK Approach (Strategy Pattern)
Originally planned to use OOP strategy pattern:
```typescript
// Strategy pattern approach (NOT USING)
class EvmStrategy implements ChainStrategy {
  async getBalance(address: string) {
    return getCoinBalance({ chain: this.chain, address })
  }
}
```

**Problem:** Unnecessary abstraction layer wrapping core's already-elegant dispatch.

### Final SDK Approach (Functional Adapters)
SDK as thin formatting/caching layer:
```typescript
// Functional adapter approach (USING THIS)
class Vault {
  async balance(chain: string): Promise<Balance> {
    // Cache check
    const cached = this.cache.get(...)
    if (cached) return cached

    // Direct core call
    const raw = await getCoinBalance({ chain, address })

    // Format and cache
    const balance = formatBalance(raw, chain)
    this.cache.set(balance)
    return balance
  }
}
```

**Benefits:**
- ✓ Aligns with core's functional pattern
- ✓ 70% less code (~800 lines vs ~2500 lines)
- ✓ 2 layers instead of 3 (Vault → Core vs Vault → Strategy → Core)
- ✓ No strategy classes to maintain (remove 16 files)
- ✓ Easy to understand and debug

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  Vultisig (Main SDK)                    │
│  - Vault lifecycle (create/import)      │
│  - Global config (chains, currency)     │
│  - Server/WASM management               │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Vault (Core Class)                     │
│  - Calls core functions directly        │
│  - Manages caching (5-min TTL)          │
│  - Uses adapters for formatting         │
│  - Chain/token management               │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Adapter Utilities                      │
│  - formatBalance(bigint → Balance)      │
│  - formatGasInfo(FeeQuote → GasInfo)    │
│  - buildKeysignPayload(Tx → Payload)    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Core Functions (Functional Dispatch)   │
│  - getCoinBalance() - all chains ✓      │
│  - deriveAddress() - all chains ✓       │
│  - getFeeQuote() - all chains ✓         │
│  - getKeysignTxData() - all chains ✓    │
│  - getEncodedSigningInputs() - all ✓    │
│  - buildChainSpecific() - all ✓         │
└─────────────────────────────────────────┘
```

---

## What Gets Removed

### Delete Entire Strategy Infrastructure

**Directories to delete:**
```bash
rm -rf packages/sdk/src/chains/evm/
rm -rf packages/sdk/src/chains/utxo/
rm -rf packages/sdk/src/chains/solana/
rm -rf packages/sdk/src/chains/strategies/
rm -rf packages/sdk/src/chains/cosmos/
rm -rf packages/sdk/src/chains/sui/
rm -rf packages/sdk/src/chains/polkadot/
rm -rf packages/sdk/src/chains/ton/
rm -rf packages/sdk/src/chains/ripple/
rm -rf packages/sdk/src/chains/tron/
rm -rf packages/sdk/src/chains/cardano/

# Keep only:
# packages/sdk/src/chains/config/ChainConfig.ts
```

**Files to delete:**
- ❌ `packages/sdk/src/chains/evm/EvmStrategy.ts` (~200 lines)
- ❌ `packages/sdk/src/chains/utxo/UtxoStrategy.ts` (~150 lines)
- ❌ `packages/sdk/src/chains/solana/SolanaStrategy.ts` (~250 lines)
- ❌ `packages/sdk/src/chains/strategies/ChainStrategy.ts` (~130 lines)
- ❌ `packages/sdk/src/chains/strategies/ChainStrategyFactory.ts` (~100 lines)
- ❌ All parsers, builders, utilities in chain-specific directories

### Delete Unnecessary Service Layers

**Files to delete:**
- ❌ `packages/sdk/src/vault/services/AddressService.ts` (~80 lines)
- ❌ `packages/sdk/src/vault/services/BalanceService.ts` (~120 lines)
- ❌ `packages/sdk/src/vault/services/SigningService.ts` (~150 lines)

**Reasoning:** Vault calls core directly - no service indirection needed.

### Keep Essential Components

**Keep these services:**
- ✓ `packages/sdk/src/vault/services/CacheService.ts` - TTL-based caching
- ✓ `packages/sdk/src/vault/services/FastSigningService.ts` - Server MPC coordination

**Keep these utilities:**
- ✓ `packages/sdk/src/chains/config/ChainConfig.ts` - Chain metadata lookup
- ✓ `packages/sdk/src/wasm/WASMManager.ts` - WASM initialization
- ✓ `packages/sdk/src/server/ServerManager.ts` - Server communication

**Total code reduction:** ~1700 lines deleted

---

## New File Structure

```
packages/sdk/src/
├── VultisigSDK.ts                  # Main SDK entry point
├── VaultManager.ts                 # Vault lifecycle management
├── ChainManager.ts                 # Chain config management
├── index.ts                        # Public API exports
│
├── vault/
│   ├── Vault.ts                    # MAIN CLASS - calls core directly
│   ├── VaultServices.ts            # Simplified service injection
│   ├── VaultError.ts               # Error types
│   │
│   ├── services/
│   │   ├── CacheService.ts         # TTL caching (KEEP)
│   │   └── FastSigningService.ts   # Server MPC coordination (KEEP)
│   │
│   ├── adapters/                   # NEW - Format utilities
│   │   ├── formatBalance.ts        # bigint → Balance
│   │   ├── formatGasInfo.ts        # FeeQuote → GasInfo
│   │   └── buildKeysignPayload.ts  # Transaction → KeysignPayload
│   │
│   └── utils/
│       └── validation.ts           # Input validation helpers
│
├── chains/
│   └── config/
│       └── ChainConfig.ts          # Chain metadata (KEEP)
│
├── server/
│   └── ServerManager.ts            # VultiServer communication (KEEP)
│
├── wasm/
│   └── WASMManager.ts              # WASM initialization (KEEP)
│
└── types/                          # SDK public types
    ├── index.ts
    ├── Balance.ts
    ├── GasInfo.ts
    ├── Signature.ts
    ├── Token.ts
    └── Value.ts
```

---

## Core Functions Being Reused

### From @core/chain

| Function | Purpose | Chains Supported |
|----------|---------|------------------|
| `deriveAddress()` | Address derivation | All 34 chains ✓ |
| `getCoinBalance()` | Balance fetching | All 34 chains ✓ |
| `getFeeQuote()` | Gas/fee estimation | All 34 chains ✓ |
| `chainFeeCoin` | Native token metadata | All 34 chains ✓ |
| `getChainKind()` | Chain categorization | All 10 kinds ✓ |

**Token support built-in:**
- ERC-20 tokens (EVM chains) ✓
- SPL tokens (Solana) ✓
- Wasm tokens (Cosmos chains) ✓

### From @core/mpc/keysign

| Function | Purpose | Chains Supported |
|----------|---------|------------------|
| `getKeysignTxData()` | Chain tx data (nonce, sequence) | All 34 chains ✓ |
| `getEncodedSigningInputs()` | Protobuf signing inputs | All 34 chains ✓ |
| `getFeeAmount()` | Fee calculation from payload | All 34 chains ✓ |
| `buildChainSpecific()` | Chain-specific keysign data | All chains (Thor, Maya separate) ✓ |

### From @core/chain/publicKey

| Function | Purpose |
|----------|---------|
| `getPublicKey()` | Derive public key with BIP32 paths |

### From @core/chain/swap

| Function | Purpose | Chains Supported |
|----------|---------|------------------|
| `findSwapQuote()` | Find best swap route | Native: THORChain, Maya; DEX: 1inch, Kyber, Lifi |
| `getSwapQuoteProviderName()` | Get provider name from quote | All swap providers ✓ |
| `getSwapKeysignPayloadFields()` | Build swap keysign payload | All swap types ✓ |
| `swapEnabledChains` | List of swap-enabled chains | ~20+ chains ✓ |

**Swap Providers:**
- **Native (cross-chain):** THORChain, MayaChain
- **DEX Aggregators (same-chain):** 1inch (EVM), Kyber (EVM), Lifi (EVM + cross-chain)

**Note:** Core has resolvers for all 10 ChainKinds (evm, cosmos, solana, cardano, utxo, ripple, polkadot, sui, ton, tron).

---

## Implementation Tasks

### Phase 1: Cleanup (1-2 hours)

**Task 1.1: Delete strategy infrastructure**
```bash
# Delete all strategy-related files
rm -rf packages/sdk/src/chains/evm/
rm -rf packages/sdk/src/chains/utxo/
rm -rf packages/sdk/src/chains/solana/
rm -rf packages/sdk/src/chains/strategies/

# Delete unnecessary services
rm packages/sdk/src/vault/services/AddressService.ts
rm packages/sdk/src/vault/services/BalanceService.ts
rm packages/sdk/src/vault/services/SigningService.ts
```

**Task 1.2: Update VaultServices interface**

File: `packages/sdk/src/vault/VaultServices.ts`

```typescript
import { FastSigningService } from './services/FastSigningService'
import { WASMManager } from '../wasm/WASMManager'

// Simplified - only essential services
export interface VaultServices {
  wasmManager: WASMManager
  fastSigningService?: FastSigningService
}

export interface VaultConfig {
  defaultChains?: string[]
  defaultCurrency?: string
}
```

**Task 1.3: Update VaultManager**

File: `packages/sdk/src/VaultManager.ts`

Remove strategy factory, simplify service creation:

```typescript
private createVaultServices(): VaultServices {
  return {
    wasmManager: this.wasmManager,
    fastSigningService: new FastSigningService(
      this.serverManager,
      this.wasmManager
    )
  }
}

createVaultInstance(vaultData: CoreVault): Vault {
  return new Vault(
    vaultData,
    this.createVaultServices(),
    {
      defaultChains: this.config.defaultChains,
      defaultCurrency: this.config.defaultCurrency
    }
  )
}
```

---

### Phase 2: Create Adapter Utilities (1 hour)

**Task 2.1: Create formatBalance adapter**

File: `packages/sdk/src/vault/adapters/formatBalance.ts`

```typescript
import { ChainConfig } from '../../chains/config/ChainConfig'
import { Balance, Token } from '../../types'

/**
 * Convert raw bigint balance to SDK Balance format
 */
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
    // Native balance - use ChainConfig
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

**Task 2.2: Create formatGasInfo adapter**

File: `packages/sdk/src/vault/adapters/formatGasInfo.ts`

```typescript
import { ChainConfig } from '../../chains/config/ChainConfig'
import { GasInfo } from '../../types'

/**
 * Convert core FeeQuote to SDK GasInfo format
 */
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

**Task 2.3: Create buildKeysignPayload helper**

File: `packages/sdk/src/vault/adapters/buildKeysignPayload.ts`

```typescript
import { Chain } from '@core/chain/Chain'
import { WalletCore } from '@trustwallet/wallet-core'
import { getKeysignTxData } from '@core/mpc/keysign/txData'
import { buildChainSpecific } from '@core/mpc/keysign/chainSpecific/build'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

/**
 * Build keysign payload for MPC signing
 */
export async function buildKeysignPayload(
  payload: any, // SigningPayload from SDK
  chain: Chain,
  walletCore: WalletCore,
  vaultData: any
): Promise<KeysignPayload> {
  // Get transaction data from core
  const txData = await getKeysignTxData({
    coin: { chain },
    // ... map payload fields
  })

  // Build chain-specific data using core
  const chainSpecific = buildChainSpecific({
    chain,
    // ... map payload fields
  })

  // Combine into keysign payload
  return {
    ...txData,
    blockchainSpecific: chainSpecific,
    coin: { chain },
    // ... other fields
  } as KeysignPayload
}
```

---

### Phase 3: Rewrite Vault Class (3-4 hours)

File: `packages/sdk/src/vault/Vault.ts`

**Task 3.1: Core imports and setup**

```typescript
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@core/chain/Chain'

// Core functions (functional dispatch)
import { getCoinBalance } from '@core/chain/coin/balance'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getFeeQuote } from '@core/chain/feeQuote'
import { getKeysignTxData } from '@core/mpc/keysign/txData'
import { getEncodedSigningInputs } from '@core/mpc/keysign/signingInputs'

// SDK utilities
import { ChainConfig } from '../chains/config/ChainConfig'
import { CacheService } from './services/CacheService'
import { FastSigningService } from './services/FastSigningService'
import { formatBalance } from './adapters/formatBalance'
import { formatGasInfo } from './adapters/formatGasInfo'
import { buildKeysignPayload } from './adapters/buildKeysignPayload'
import { VaultError, VaultErrorCode } from './VaultError'

// Types
import {
  Balance,
  GasInfo,
  Signature,
  SigningPayload,
  Token,
  Value
} from '../types'
```

**Task 3.2: Address methods**

```typescript
/**
 * Get address for specified chain
 * Uses core's deriveAddress() with permanent caching
 */
async address(chain: string): Promise<string> {
  const cacheKey = `address:${chain}`

  // Check permanent cache
  const cached = this.cacheService.get<string>(cacheKey, Infinity)
  if (cached) return cached

  try {
    // Get chain enum
    const chainEnum = ChainConfig.getChainEnum(chain)

    // Get WalletCore
    const walletCore = await this.wasmManager.getWalletCore()

    // Get public key using core
    const publicKey = getPublicKey({
      chain: chainEnum,
      walletCore,
      publicKeys: this.data.publicKeys,
      hexChainCode: this.data.hexChainCode
    })

    // Derive address using core (handles all chain-specific logic)
    const address = deriveAddress({
      chain: chainEnum,
      publicKey,
      walletCore
    })

    // Cache permanently (addresses don't change)
    this.cacheService.set(cacheKey, address)
    return address

  } catch (error) {
    throw new VaultError(
      VaultErrorCode.AddressDerivationFailed,
      `Failed to derive address for ${chain}`,
      error as Error
    )
  }
}

/**
 * Get addresses for multiple chains
 */
async addresses(chains?: string[]): Promise<Record<string, string>> {
  const chainsToDerive = chains || this._userChains
  const result: Record<string, string> = {}

  // Parallel derivation
  await Promise.all(
    chainsToDerive.map(async (chain) => {
      try {
        result[chain] = await this.address(chain)
      } catch (error) {
        console.warn(`Failed to derive address for ${chain}:`, error)
      }
    })
  )

  return result
}
```

**Task 3.3: Balance methods**

```typescript
/**
 * Get balance for chain (with optional token)
 * Uses core's getCoinBalance() with 5-minute TTL cache
 */
async balance(chain: string, tokenId?: string): Promise<Balance> {
  const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`

  // Check 5-min TTL cache
  const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)
  if (cached) return cached

  try {
    const address = await this.address(chain)
    const chainEnum = ChainConfig.getChainEnum(chain)

    // Core handles balance fetching for ALL chains
    // Supports: native, ERC-20, SPL, wasm tokens automatically
    const rawBalance = await getCoinBalance({
      chain: chainEnum,
      address,
      contractAddress: tokenId
    })

    // Format using adapter
    const balance = formatBalance(rawBalance, chain, tokenId, this._tokens)

    // Cache with 5-min TTL
    this.cacheService.set(cacheKey, balance)
    return balance

  } catch (error) {
    throw new VaultError(
      VaultErrorCode.BalanceFetchFailed,
      `Failed to fetch balance for ${chain}${tokenId ? `:${tokenId}` : ''}`,
      error as Error
    )
  }
}

/**
 * Get balances for multiple chains
 */
async balances(
  chains?: string[],
  includeTokens = false
): Promise<Record<string, Balance>> {
  const chainsToFetch = chains || this._userChains
  const result: Record<string, Balance> = {}

  for (const chain of chainsToFetch) {
    try {
      // Native balance
      result[chain] = await this.balance(chain)

      // Token balances
      if (includeTokens) {
        const tokens = this._tokens[chain] || []
        for (const token of tokens) {
          result[`${chain}:${token.id}`] = await this.balance(chain, token.id)
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch balance for ${chain}:`, error)
    }
  }

  return result
}

/**
 * Force refresh balance (clear cache)
 */
async updateBalance(chain: string, tokenId?: string): Promise<Balance> {
  const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`
  this.cacheService.clear(cacheKey)
  return this.balance(chain, tokenId)
}
```

**Task 3.4: Gas estimation**

```typescript
/**
 * Get gas info for chain
 * Uses core's getFeeQuote()
 */
async gas(chain: string): Promise<GasInfo> {
  try {
    const chainEnum = ChainConfig.getChainEnum(chain)

    // Core handles gas estimation for all chains
    const feeQuote = await getFeeQuote({
      coin: { chain: chainEnum }
    })

    // Format using adapter
    return formatGasInfo(feeQuote, chain)

  } catch (error) {
    throw new VaultError(
      VaultErrorCode.GasEstimationFailed,
      `Failed to estimate gas for ${chain}`,
      error as Error
    )
  }
}
```

**Task 3.5: Signing methods**

```typescript
/**
 * Sign transaction
 */
async sign(payload: SigningPayload): Promise<Signature> {
  try {
    const chainEnum = ChainConfig.getChainEnum(payload.chain)
    const walletCore = await this.wasmManager.getWalletCore()

    // Build keysign payload using core functions and adapter
    const keysignPayload = await buildKeysignPayload(
      payload,
      chainEnum,
      walletCore,
      this.data
    )

    // Check vault type
    const isFastVault = this.data.signers.some(s => s.startsWith('Server-'))

    if (isFastVault && this.fastSigningService) {
      // Fast signing via server MPC
      return this.fastSigningService.coordinateFastSigning({
        vault: this.data,
        keysignPayload,
        chain: chainEnum
      })
    } else {
      // Relay/local signing (future implementation)
      throw new VaultError(
        VaultErrorCode.SigningFailed,
        'Relay/local signing not implemented yet'
      )
    }

  } catch (error) {
    throw new VaultError(
      VaultErrorCode.SigningFailed,
      `Failed to sign transaction for ${payload.chain}`,
      error as Error
    )
  }
}
```

**Task 3.6: Token management**

```typescript
setTokens(chain: string, tokens: Token[]): void {
  this._tokens[chain] = tokens
}

addToken(chain: string, token: Token): void {
  if (!this._tokens[chain]) this._tokens[chain] = []
  if (!this._tokens[chain].find(t => t.id === token.id)) {
    this._tokens[chain].push(token)
  }
}

removeToken(chain: string, tokenId: string): void {
  if (this._tokens[chain]) {
    this._tokens[chain] = this._tokens[chain].filter(t => t.id !== tokenId)
  }
}

getTokens(chain: string): Token[] {
  return this._tokens[chain] || []
}
```

**Task 3.7: Chain management**

```typescript
async setChains(chains: string[]): Promise<void> {
  // Validate all chains
  chains.forEach(chain => {
    if (!ChainConfig.isSupported(chain)) {
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Chain not supported: ${chain}`
      )
    }
  })

  this._userChains = chains

  // Pre-derive addresses
  await this.addresses(chains)
}

async addChain(chain: string): Promise<void> {
  if (!ChainConfig.isSupported(chain)) {
    throw new VaultError(
      VaultErrorCode.ChainNotSupported,
      `Chain not supported: ${chain}`
    )
  }

  if (!this._userChains.includes(chain)) {
    this._userChains.push(chain)
    await this.address(chain) // Pre-derive
  }
}

async removeChain(chain: string): Promise<void> {
  this._userChains = this._userChains.filter(c => c !== chain)
}

getChains(): string[] {
  return [...this._userChains]
}

async resetToDefaultChains(): Promise<void> {
  this._userChains = ChainConfig.getDefaultChains()
}
```

---

### Phase 4: Update Dependencies (1 hour)

**Task 4.1: Update FastSigningService**

File: `packages/sdk/src/vault/services/FastSigningService.ts`

Remove strategy dependencies, use core functions directly if needed.

**Task 4.2: Update exports**

File: `packages/sdk/src/index.ts`

Remove strategy exports, ensure adapters are not exported (internal only):

```typescript
// Core classes
export { Vultisig } from './VultisigSDK'
export { Vault } from './vault/Vault'

// Types
export * from './types'

// Errors
export { VaultError, VaultErrorCode } from './vault/VaultError'

// Utilities
export { ValidationHelpers } from './vault/utils/validation'

// DO NOT export adapters (internal)
// DO NOT export strategies (deleted)
```

---

### Phase 5: Swap Integration (3 hours)

**Overview:** Expose core's comprehensive swap functionality through Vault API.

Core provides:
- **Native Swaps** (cross-chain): THORChain, MayaChain
- **DEX Aggregators** (same-chain): 1inch, Kyber, Lifi
- **Smart quote finding** with automatic provider fallback
- **Swap keysign payload** building

**Task 5.1: Add swap types**

File: `packages/sdk/src/types/Swap.ts` (NEW)

```typescript
import { SwapQuote as CoreSwapQuote } from '@core/chain/swap/quote/SwapQuote'

export interface SwapParams {
  fromChain: string
  fromToken?: Token          // undefined = native token
  toChain: string
  toToken?: Token            // undefined = native token
  amount: number             // In human-readable format
  slippage?: number          // Default: 3%
  affiliateBps?: number      // Affiliate fee in basis points
  onProgress?: (step: SwapStep) => void
}

export interface SwapQuoteParams {
  fromChain: string
  fromToken?: Token
  toChain: string
  toToken?: Token
  amount: number
  affiliateBps?: number
}

export interface SwapResult {
  txHash: string
  quote: CoreSwapQuote
  provider: SwapProvider
  fromAmount: string         // Actual from amount
  toAmount: string           // Expected to amount
  fees: SwapFee
}

export type SwapProvider = 'thorchain' | 'maya' | '1inch' | 'kyber' | 'lifi'

export interface SwapFee {
  amount: string
  symbol: string
  usd?: number
}

export interface SwapStep {
  step: 'quoting' | 'signing' | 'broadcasting' | 'complete'
  progress: number           // 0-100
  message: string
  provider?: SwapProvider
}

export { SwapQuote } from '@core/chain/swap/quote/SwapQuote'
```

**Task 5.2: Add swap methods to Vault**

File: `packages/sdk/src/vault/Vault.ts`

```typescript
import { findSwapQuote } from '@core/chain/swap/quote/findSwapQuote'
import { getSwapQuoteProviderName } from '@core/chain/swap/quote/getSwapQuoteProviderName'
import { swapEnabledChains } from '@core/chain/swap/swapEnabledChains'
import { NoSwapRoutesError } from '@core/chain/swap/NoSwapRoutesError'

// Add to Vault class:

/**
 * Get swap quote without executing
 * Uses core's findSwapQuote with automatic provider selection
 */
async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  try {
    const fromAddress = await this.address(params.fromChain)
    const toAddress = await this.address(params.toChain)

    const fromChain = ChainConfig.getChainEnum(params.fromChain)
    const toChain = ChainConfig.getChainEnum(params.toChain)

    // Core finds best route across all providers
    const quote = await findSwapQuote({
      from: {
        chain: fromChain,
        address: fromAddress,
        decimals: params.fromToken?.decimals ?? ChainConfig.getDecimals(params.fromChain),
        ticker: params.fromToken?.symbol ?? ChainConfig.getSymbol(params.fromChain),
        id: params.fromToken?.id,
      },
      to: {
        chain: toChain,
        address: toAddress,
        decimals: params.toToken?.decimals ?? ChainConfig.getDecimals(params.toChain),
        ticker: params.toToken?.symbol ?? ChainConfig.getSymbol(params.toChain),
        id: params.toToken?.id,
      },
      amount: params.amount,
      affiliateBps: params.affiliateBps
    })

    return quote

  } catch (error) {
    if (error instanceof NoSwapRoutesError) {
      throw new VaultError(
        VaultErrorCode.NoSwapRoutes,
        `No swap routes available between ${params.fromChain} and ${params.toChain}`
      )
    }
    throw new VaultError(
      VaultErrorCode.SwapQuoteFailed,
      `Failed to get swap quote: ${(error as Error).message}`,
      error as Error
    )
  }
}

/**
 * Execute swap transaction
 * Gets quote, builds keysign payload, signs, and broadcasts
 */
async swap(params: SwapParams): Promise<SwapResult> {
  try {
    // Step 1: Get quote
    params.onProgress?.({
      step: 'quoting',
      progress: 25,
      message: 'Finding best swap route...'
    })

    const quote = await this.getSwapQuote({
      fromChain: params.fromChain,
      fromToken: params.fromToken,
      toChain: params.toChain,
      toToken: params.toToken,
      amount: params.amount,
      affiliateBps: params.affiliateBps
    })

    const provider = getSwapQuoteProviderName(quote)

    // Step 2: Build keysign payload from quote
    params.onProgress?.({
      step: 'signing',
      progress: 50,
      message: `Signing swap via ${provider}...`,
      provider
    })

    // Core provides swap-specific keysign payload builder
    const keysignPayload = await buildSwapKeysignPayload(quote, params)

    // Step 3: Sign transaction using existing flow
    params.onProgress?.({
      step: 'broadcasting',
      progress: 75,
      message: 'Broadcasting transaction...'
    })

    const signature = await this.sign({
      chain: params.fromChain,
      keysignPayload
    })

    // Step 4: Complete
    params.onProgress?.({
      step: 'complete',
      progress: 100,
      message: 'Swap complete!',
      provider
    })

    return {
      txHash: signature.txHash ?? '',
      quote,
      provider,
      fromAmount: params.amount.toString(),
      toAmount: quote.expectedToAmount, // From quote
      fees: {
        amount: quote.fees.amount,
        symbol: quote.fees.symbol,
        usd: quote.fees.usd
      }
    }

  } catch (error) {
    if (error instanceof NoSwapRoutesError) {
      throw new VaultError(
        VaultErrorCode.NoSwapRoutes,
        `No swap routes available between ${params.fromChain} and ${params.toChain}`
      )
    }

    throw new VaultError(
      VaultErrorCode.SwapFailed,
      `Swap failed: ${(error as Error).message}`,
      error as Error
    )
  }
}

/**
 * Get chains that support swapping
 */
getSwapEnabledChains(): string[] {
  return swapEnabledChains.map(chain => chain.toString())
}

/**
 * Check if swap is supported between two chains
 */
isSwapSupported(fromChain: string, toChain: string): boolean {
  const enabled = this.getSwapEnabledChains()
  return enabled.includes(fromChain) && enabled.includes(toChain)
}
```

**Task 5.3: Create swap keysign adapter**

File: `packages/sdk/src/vault/adapters/buildSwapKeysignPayload.ts` (NEW)

```typescript
import { SwapQuote } from '@core/chain/swap/quote/SwapQuote'
import { getSwapKeysignPayloadFields } from '@core/chain/swap/keysign/getSwapKeysignPayloadFields'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

/**
 * Build keysign payload for swap transaction
 * Uses core's swap keysign builder
 */
export async function buildSwapKeysignPayload(
  quote: SwapQuote,
  params: any
): Promise<KeysignPayload> {
  // Core provides swap-specific keysign fields
  const swapFields = getSwapKeysignPayloadFields({
    quote,
    slippage: params.slippage ?? 3,
  })

  return {
    ...swapFields,
    // Additional fields...
  } as KeysignPayload
}
```

**Task 5.4: Add swap error codes**

File: `packages/sdk/src/vault/VaultError.ts`

```typescript
export enum VaultErrorCode {
  // ... existing codes
  NoSwapRoutes = 'NO_SWAP_ROUTES',
  SwapQuoteFailed = 'SWAP_QUOTE_FAILED',
  SwapFailed = 'SWAP_FAILED',
}
```

**Task 5.5: Update public exports**

File: `packages/sdk/src/index.ts`

```typescript
// Export swap types
export type {
  SwapParams,
  SwapQuoteParams,
  SwapResult,
  SwapProvider,
  SwapFee,
  SwapStep,
  SwapQuote
} from './types/Swap'
```

---

### Phase 6: Testing (2-3 hours)

**Task 5.1: Address derivation tests**

Test all 34 chains:
```typescript
// Test EVM chains (11)
const evmChains = ['Ethereum', 'Arbitrum', 'Base', 'Blast', 'Optimism',
                   'Zksync', 'Polygon', 'BSC', 'Avalanche', 'Mantle', 'Cronos']

// Test UTXO chains (6)
const utxoChains = ['Bitcoin', 'Litecoin', 'BitcoinCash', 'Dogecoin', 'Dash', 'Zcash']

// Test Cosmos chains (10)
const cosmosChains = ['Cosmos', 'Osmosis', 'Dydx', 'Kujira', 'Terra',
                      'TerraClassic', 'Noble', 'Akash', 'THORChain', 'MayaChain']

// Test Other chains (7)
const otherChains = ['Solana', 'Sui', 'Polkadot', 'Ton', 'Ripple', 'Tron', 'Cardano']

for (const chain of [...evmChains, ...utxoChains, ...cosmosChains, ...otherChains]) {
  const address = await vault.address(chain)
  expect(address).toBeTruthy()
  console.log(`${chain}: ${address}`)
}
```

**Task 5.2: Balance fetching tests**

```typescript
// Native balances
const ethBalance = await vault.balance('Ethereum')
const btcBalance = await vault.balance('Bitcoin')
const solBalance = await vault.balance('Solana')

// Token balances
const usdcBalance = await vault.balance('Ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
```

**Task 5.3: Gas estimation tests**

```typescript
const ethGas = await vault.gas('Ethereum')
expect(ethGas.maxFeePerGas).toBeDefined()
expect(ethGas.priorityFee).toBeDefined()

const btcGas = await vault.gas('Bitcoin')
expect(btcGas.gasPrice).toBeDefined()
```

**Task 5.4: Caching tests**

```typescript
// Address caching (permanent)
const addr1 = await vault.address('Ethereum')
const addr2 = await vault.address('Ethereum') // Should hit cache
expect(addr1).toBe(addr2)

// Balance caching (5-min TTL)
const bal1 = await vault.balance('Ethereum')
await new Promise(r => setTimeout(r, 100))
const bal2 = await vault.balance('Ethereum') // Should hit cache
expect(bal1).toEqual(bal2)
```

---

## Core Swap Capabilities (Available to Reuse)

Core provides a **comprehensive swap system**:

### Swap Providers
- **Native Swaps** (cross-chain): THORChain, MayaChain
- **DEX Aggregators** (same-chain): 1inch, Kyber, Lifi

### Smart Quote Finding
```typescript
// Core automatically finds best route across all providers
export const findSwapQuote = ({
  from,  // Source coin with chain, address, decimals
  to,    // Destination coin
  amount,
  affiliateBps
}): Promise<SwapQuote>
```

### Features
- ✓ Automatic provider selection and fallback
- ✓ Cross-chain swaps (via THORChain/Maya)
- ✓ Same-chain swaps (via 1inch/Kyber/Lifi)
- ✓ Affiliate fee support
- ✓ Swap keysign payload building
- ✓ Swap-enabled chain validation

### Supported Chains
Core exports `swapEnabledChains` with all chains that support swapping.

---

## Implementation Checklist

### Phase 1: Cleanup
- [ ] Delete strategy directories and files
- [ ] Delete service files (AddressService, BalanceService, SigningService)
- [ ] Update VaultServices interface
- [ ] Update VaultManager to remove strategy factory
- [ ] Verify no broken imports

### Phase 2: Adapters
- [ ] Create `formatBalance.ts`
- [ ] Create `formatGasInfo.ts`
- [ ] Create `buildKeysignPayload.ts`
- [ ] Add unit tests for adapters

### Phase 3: Vault Rewrite
- [ ] Implement `address()` method
- [ ] Implement `addresses()` method
- [ ] Implement `balance()` method
- [ ] Implement `balances()` method
- [ ] Implement `updateBalance()` method
- [ ] Implement `updateBalances()` method
- [ ] Implement `gas()` method
- [ ] Implement `sign()` method
- [ ] Implement token management methods
- [ ] Implement chain management methods
- [ ] Add proper error handling
- [ ] Add JSDoc comments

### Phase 4: Update Dependencies
- [ ] Update FastSigningService if needed
- [ ] Update public API exports
- [ ] Update TypeScript types
- [ ] Fix any type errors
- [ ] Run type checking: `npm run typecheck`

### Phase 5: Swap Integration
- [ ] Create `types/Swap.ts` with all swap types
- [ ] Add `getSwapQuote()` method to Vault
- [ ] Add `swap()` method to Vault
- [ ] Add `getSwapEnabledChains()` helper
- [ ] Add `isSwapSupported()` helper
- [ ] Create `buildSwapKeysignPayload` adapter
- [ ] Add swap error codes to VaultError
- [ ] Export swap types from index.ts
- [ ] Add JSDoc comments

### Phase 6: Testing
- [ ] Test address derivation (all 34 chains)
- [ ] Test balance fetching (native + tokens)
- [ ] Test gas estimation (all chain types)
- [ ] Test caching behavior (address + balance)
- [ ] Test token management
- [ ] Test chain management
- [ ] Test error handling
- [ ] Run all tests: `npm test`

### Phase 6: Documentation
- [ ] Update ARCHITECTURE.md
- [ ] Update API documentation
- [ ] Add usage examples
- [ ] Document adapter utilities
- [ ] Update migration guide

---

## Success Criteria

- ✓ All strategy files deleted (~1700 lines removed)
- ✓ All service layers removed except essential ones
- ✓ Vault calls core functions directly
- ✓ All 34 chains supported via core resolvers
- ✓ Token balances work (ERC-20, SPL, wasm)
- ✓ Gas estimation works for all chain types
- ✓ Swapping works (native + DEX aggregators)
- ✓ Swap quote fetching works with provider fallback
- ✓ Caching works (permanent for addresses, 5-min TTL for balances)
- ✓ All tests pass
- ✓ Type checking passes
- ✓ Code reduction: ~70% less code than strategy approach

---

## Comparison: Strategy vs Adapter

| Aspect | Strategy Pattern | Functional Adapters |
|--------|------------------|---------------------|
| **Files** | ~16 strategy classes + 3 services | ~3 adapter utils |
| **Lines of code** | ~2500 lines | ~800 lines |
| **Abstraction layers** | 3 (Vault→Service→Strategy→Core) | 2 (Vault→Core) |
| **Mental model** | OOP (classes, inheritance) | Functional (like core) |
| **Maintenance** | Update multiple classes | Update Vault + adapters |
| **Adding chain** | New strategy class | Already supported by core |
| **Type safety** | Via interfaces | Via core types |
| **Alignment with core** | Different pattern | Same pattern |

---

## Timeline Estimate

| Phase | Tasks | Hours |
|-------|-------|-------|
| Phase 1: Cleanup | Delete files, update interfaces | 1-2 |
| Phase 2: Adapters | Create 3 adapter utilities | 1 |
| Phase 3: Vault Rewrite | Implement all methods | 3-4 |
| Phase 4: Update Dependencies | Update dependencies | 1 |
| Phase 5: Swap Integration | Add swap functionality | 3 |
| Phase 6: Testing | Test all functionality | 2-3 |
| **Total** | | **11-14 hours** |

**Compare to strategy approach:** 18-23 hours (35% faster!)

---

## Next Steps

1. ✓ Review and approve this plan
2. Create feature branch: `git checkout -b feature/functional-adapters`
3. Start with Phase 1 (cleanup)
4. Implement phases sequentially
5. Test thoroughly after each phase
6. Create PR when complete

---

## Notes

- Core already has ALL resolver implementations ✓
- No need to implement chain-specific logic in SDK ✓
- SDK is purely formatting/caching layer ✓
- Alignment with core's functional pattern ✓
- Much simpler and more maintainable ✓
