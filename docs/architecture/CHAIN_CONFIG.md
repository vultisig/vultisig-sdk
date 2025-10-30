# ChainConfig: Centralized Chain Configuration

**Last Updated:** 2025-10-30
**Version:** 2.0

---

## Overview

`ChainConfig` is the **single source of truth** for all blockchain metadata in the Vultisig SDK. It consolidates chain information that was previously scattered across multiple files, providing a centralized registry for chain identification, metadata, and type categorization.

**Location:** [ChainConfig.ts](../../packages/sdk/src/chains/config/ChainConfig.ts)

---

## What ChainConfig Replaces

ChainConfig consolidates functionality from several deprecated components:

### Before (Old Architecture)
```typescript
// Chain mapping was in AddressDeriver.ts
AddressDeriver.mapStringToChain('ethereum') // => Chain.Ethereum

// Decimals and symbols were in BalanceService.ts
BalanceService.getDecimalsForChain('Ethereum') // => 18
BalanceService.getSymbolForChain('Ethereum')   // => 'ETH'

// Supported chains list in ChainManagement.ts
ChainManagement.getSupportedChains()

// Hardcoded chain lists in ChainStrategyFactory.ts
const evmChains = ['Ethereum', 'Arbitrum', 'Base', ...]
```

### After (New Architecture)
```typescript
// All chain information in one place
import { ChainConfig } from '@/chains/config/ChainConfig'

ChainConfig.getChainEnum('ethereum')      // => Chain.Ethereum
ChainConfig.getDecimals('Ethereum')       // => 18
ChainConfig.getSymbol('Ethereum')         // => 'ETH'
ChainConfig.getSupportedChains()          // => ['Bitcoin', 'Ethereum', ...]
ChainConfig.getEvmChains()                // => ['Ethereum', 'Arbitrum', ...]
```

---

## Chain Metadata Structure

Each chain in the registry has the following metadata:

```typescript
interface ChainMetadata {
  /** Official chain identifier (e.g., 'Ethereum') */
  id: string

  /** Chain enum value from @core/chain/Chain */
  chainEnum: Chain

  /** Native token decimals (e.g., 18 for ETH, 8 for BTC) */
  decimals: number

  /** Native token symbol (e.g., 'ETH', 'BTC') */
  symbol: string

  /** Chain type category */
  type: ChainType  // 'evm' | 'utxo' | 'cosmos' | 'other'

  /** Alternative names/aliases for this chain */
  aliases: string[]  // e.g., ['ethereum', 'eth']
}
```

### Example: Ethereum

```typescript
{
  id: 'Ethereum',
  chainEnum: Chain.Ethereum,
  decimals: 18,
  symbol: 'ETH',
  type: 'evm',
  aliases: ['eth', 'ethereum']
}
```

---

## Chain Type System

ChainConfig categorizes chains into four types:

### 1. EVM Chains (`'evm'`)
**Implemented:** Yes ✅

Ethereum Virtual Machine compatible chains using EvmStrategy:
- Ethereum, Arbitrum, Base, Blast, Optimism, zkSync
- Polygon, BSC, Avalanche, Mantle, Cronos

**Characteristics:**
- 18 decimals (mostly, some exceptions like Mantle)
- ECDSA signatures with recovery ID
- EIP-1559 transaction support
- Single-message signing

### 2. UTXO Chains (`'utxo'`)
**Implemented:** Yes ✅

Bitcoin-like chains using UtxoStrategy:
- Bitcoin, Litecoin, Bitcoin Cash
- Dogecoin, Dash, Zcash

**Characteristics:**
- 8 decimals
- PSBT format
- Multi-message signing (one per input)
- SegWit or Legacy script types

### 3. Cosmos Chains (`'cosmos'`)
**Implemented:** No ⚠️ (Metadata only)

Cosmos SDK-based chains:
- THORChain (8 decimals), MayaChain (10 decimals)
- Cosmos, Osmosis, Dydx, Kujira
- Terra, TerraClassic, Noble, Akash

**Note:** These chains are registered in ChainConfig for future support but do not yet have a working CosmosStrategy implementation.

### 4. Other Chains (`'other'`)
**Partially Implemented:** Solana only ✅

Standalone chains with unique implementations:
- **Solana** (9 decimals) - IMPLEMENTED ✅
- Sui (9 decimals) - Metadata only ⚠️
- Polkadot (10 decimals) - Metadata only ⚠️
- Ton (9 decimals) - Metadata only ⚠️
- Ripple (6 decimals) - Metadata only ⚠️
- Tron (6 decimals) - Metadata only ⚠️
- Cardano (6 decimals) - Metadata only ⚠️

---

## Core API Reference

### Getting Chain Metadata

#### `getMetadata(chainId: string): ChainMetadata`

Get complete metadata for a chain. Supports case-insensitive lookup and aliases.

```typescript
// All of these work and return the same metadata:
ChainConfig.getMetadata('Ethereum')
ChainConfig.getMetadata('ethereum')
ChainConfig.getMetadata('eth')
ChainConfig.getMetadata('ETH')

// Returns:
// {
//   id: 'Ethereum',
//   chainEnum: Chain.Ethereum,
//   decimals: 18,
//   symbol: 'ETH',
//   type: 'evm',
//   aliases: ['eth', 'ethereum']
// }
```

**Throws:** Error if chain is not supported

---

### Getting Specific Properties

#### `getChainEnum(chainId: string): Chain`

Map chain identifier to Chain enum value.

**Replaces:** `AddressDeriver.mapStringToChain()`

```typescript
ChainConfig.getChainEnum('bitcoin')  // => Chain.Bitcoin
ChainConfig.getChainEnum('BTC')      // => Chain.Bitcoin
ChainConfig.getChainEnum('btc')      // => Chain.Bitcoin
```

---

#### `getDecimals(chainId: string): number`

Get native token decimal places for a chain.

**Replaces:** `BalanceService.getDecimalsForChain()`

```typescript
ChainConfig.getDecimals('Ethereum')  // => 18
ChainConfig.getDecimals('Bitcoin')   // => 8
ChainConfig.getDecimals('Solana')    // => 9
```

---

#### `getSymbol(chainId: string): string`

Get native token symbol for a chain.

**Replaces:** `BalanceService.getSymbolForChain()`

```typescript
ChainConfig.getSymbol('Ethereum')  // => 'ETH'
ChainConfig.getSymbol('Bitcoin')   // => 'BTC'
ChainConfig.getSymbol('Polygon')   // => 'MATIC'
```

---

#### `getType(chainId: string): ChainType`

Get chain type category.

```typescript
ChainConfig.getType('Ethereum')   // => 'evm'
ChainConfig.getType('Bitcoin')    // => 'utxo'
ChainConfig.getType('THORChain')  // => 'cosmos'
ChainConfig.getType('Solana')     // => 'other'
```

---

#### `getChainId(chainId: string): string`

Normalize any chain identifier to official chain ID.

```typescript
ChainConfig.getChainId('eth')       // => 'Ethereum'
ChainConfig.getChainId('ethereum')  // => 'Ethereum'
ChainConfig.getChainId('Ethereum')  // => 'Ethereum'
ChainConfig.getChainId('btc')       // => 'Bitcoin'
```

---

### Querying Supported Chains

#### `getSupportedChains(): string[]`

Get all supported chain IDs (official names only, no aliases).

**Replaces:** `ChainManagement.getSupportedChains()`

```typescript
const chains = ChainConfig.getSupportedChains()
// => ['Bitcoin', 'Ethereum', 'Solana', 'Polygon', ...]
```

---

#### `getChainsByType(type: ChainType): string[]`

Get all chains of a specific type.

```typescript
ChainConfig.getChainsByType('evm')
// => ['Ethereum', 'Arbitrum', 'Base', ...]

ChainConfig.getChainsByType('utxo')
// => ['Bitcoin', 'Litecoin', 'Bitcoin-Cash', ...]
```

---

#### `getEvmChains(): string[]`

Get all EVM chain IDs.

**Replaces:** Hardcoded list in ChainStrategyFactory

```typescript
const evmChains = ChainConfig.getEvmChains()
// => ['Ethereum', 'Arbitrum', 'Base', 'Blast', 'Optimism',
//     'Zksync', 'Mantle', 'Avalanche', 'CronosChain', 'BSC', 'Polygon']
```

---

#### `getUtxoChains(): string[]`

Get all UTXO chain IDs.

**Replaces:** Hardcoded list in ChainStrategyFactory

```typescript
const utxoChains = ChainConfig.getUtxoChains()
// => ['Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash']
```

---

#### `getCosmosChains(): string[]`

Get all Cosmos chain IDs.

```typescript
const cosmosChains = ChainConfig.getCosmosChains()
// => ['THORChain', 'MayaChain', 'Cosmos', 'Osmosis', 'Dydx',
//     'Kujira', 'Terra', 'TerraClassic', 'Noble', 'Akash']
```

**Note:** These chains have metadata but no working strategy yet.

---

### Validation Methods

#### `isSupported(chainId: string): boolean`

Check if a chain is supported (registered in ChainConfig).

```typescript
ChainConfig.isSupported('Ethereum')    // => true
ChainConfig.isSupported('eth')         // => true
ChainConfig.isSupported('FakeChain')   // => false
```

---

#### `isEvmChain(chainId: string): boolean`

Check if a chain is an EVM chain.

```typescript
ChainConfig.isEvmChain('Ethereum')  // => true
ChainConfig.isEvmChain('Bitcoin')   // => false
```

---

#### `isUtxoChain(chainId: string): boolean`

Check if a chain is a UTXO chain.

```typescript
ChainConfig.isUtxoChain('Bitcoin')   // => true
ChainConfig.isUtxoChain('Ethereum')  // => false
```

---

#### `isCosmosChain(chainId: string): boolean`

Check if a chain is a Cosmos chain.

```typescript
ChainConfig.isCosmosChain('THORChain')  // => true
ChainConfig.isCosmosChain('Ethereum')   // => false
```

---

#### `validateChains(chainIds: string[]): { valid: string[], invalid: string[] }`

Validate a list of chain identifiers.

```typescript
const result = ChainConfig.validateChains(['eth', 'btc', 'FakeChain', 'Solana'])

// Returns:
// {
//   valid: ['Ethereum', 'Bitcoin', 'Solana'],  // Normalized to official IDs
//   invalid: ['FakeChain']
// }
```

---

### Default Chains

#### `getDefaultChains(): string[]`

Get the default chains for new vaults (top 5 most commonly used).

```typescript
const defaults = ChainConfig.getDefaultChains()
// => ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
```

---

## Alias System

ChainConfig supports **case-insensitive** chain lookups with multiple aliases per chain.

### How Aliases Work

1. All lookups are case-insensitive
2. Each chain has multiple aliases (e.g., 'bitcoin', 'btc', 'BTC')
3. Aliases are resolved to the official chain ID
4. Official IDs use PascalCase (e.g., 'Bitcoin', 'Ethereum')

### Common Aliases

| Chain | Official ID | Aliases |
|-------|-------------|---------|
| Bitcoin | `Bitcoin` | `bitcoin`, `btc` |
| Ethereum | `Ethereum` | `ethereum`, `eth` |
| Polygon | `Polygon` | `polygon`, `matic` |
| BSC | `BSC` | `bsc`, `bnb`, `binance` |
| Arbitrum | `Arbitrum` | `arbitrum`, `arb` |
| Optimism | `Optimism` | `optimism`, `op` |
| THORChain | `THORChain` | `thorchain`, `thor`, `rune` |

### Example Usage

```typescript
// All of these resolve to 'Ethereum'
ChainConfig.getChainId('Ethereum')
ChainConfig.getChainId('ethereum')
ChainConfig.getChainId('eth')
ChainConfig.getChainId('ETH')

// All of these resolve to 'Polygon'
ChainConfig.getChainId('Polygon')
ChainConfig.getChainId('polygon')
ChainConfig.getChainId('matic')
ChainConfig.getChainId('MATIC')
```

---

## Adding a New Chain

To add support for a new chain, you need to update ChainConfig:

### Step 1: Add Chain Metadata

Add an entry to the `registry` object in [ChainConfig.ts](../../packages/sdk/src/chains/config/ChainConfig.ts):

```typescript
export class ChainConfig {
  private static readonly registry: Record<string, ChainMetadata> = {
    // ... existing chains ...

    // Add your new chain:
    yournewchain: {
      id: 'YourNewChain',                    // Official PascalCase ID
      chainEnum: Chain.YourNewChain,         // From @core/chain/Chain
      decimals: 18,                          // Native token decimals
      symbol: 'YNC',                         // Native token symbol
      type: 'evm',                           // Chain type: evm/utxo/cosmos/other
      aliases: ['yournewchain', 'ync'],      // Lowercase aliases
    },
  }
}
```

### Step 2: Verify Chain Type

Ensure the chain type is correct:
- **'evm'**: Ethereum Virtual Machine compatible (use EvmStrategy)
- **'utxo'**: Bitcoin-like (use UtxoStrategy)
- **'cosmos'**: Cosmos SDK-based (requires CosmosStrategy - not yet implemented)
- **'other'**: Unique implementation required

### Step 3: Implement Strategy (if needed)

For EVM and UTXO chains, no additional work needed - they use existing strategies.

For new chain types ('other'), you'll need to:
1. Create a new strategy class implementing `ChainStrategy`
2. Register it in `ChainStrategyFactory`

See [ADDING_CHAINS.md](./ADDING_CHAINS.md) for complete strategy implementation guide.

### Step 4: Register in Factory

The factory will automatically pick up EVM and UTXO chains from ChainConfig:

```typescript
// In ChainStrategyFactory.ts
const evmChains = ChainConfig.getEvmChains()  // Automatically includes your chain
factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))
```

---

## Integration Examples

### Example 1: BalanceService

```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'

export class BalanceService {
  async getBalance(chainId: string, address: string): Promise<Balance> {
    // Get chain-specific metadata
    const decimals = ChainConfig.getDecimals(chainId)
    const symbol = ChainConfig.getSymbol(chainId)

    // Fetch raw balance...
    const rawBalance = await this.fetchRawBalance(chainId, address)

    // Format with correct decimals
    return {
      value: rawBalance,
      decimals,
      symbol,
      formatted: formatBalance(rawBalance, decimals)
    }
  }
}
```

### Example 2: ChainStrategyFactory

```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'
import { EvmStrategy } from '@/chains/evm/EvmStrategy'
import { UtxoStrategy } from '@/chains/utxo/UtxoStrategy'

export function createDefaultStrategyFactory() {
  const factory = new ChainStrategyFactory()

  // Data-driven registration from ChainConfig
  const evmChains = ChainConfig.getEvmChains()
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))

  const utxoChains = ChainConfig.getUtxoChains()
  factory.registerUtxoChains(utxoChains, (chainId) => new UtxoStrategy(chainId))

  factory.register('Solana', new SolanaStrategy())

  return factory
}
```

### Example 3: User Input Validation

```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'

function validateUserChainSelection(userInput: string[]): string[] {
  const { valid, invalid } = ChainConfig.validateChains(userInput)

  if (invalid.length > 0) {
    console.warn(`Unsupported chains: ${invalid.join(', ')}`)
  }

  return valid  // Returns normalized chain IDs
}

// Usage:
const userChains = ['eth', 'btc', 'FakeChain', 'Polygon']
const validChains = validateUserChainSelection(userChains)
// => ['Ethereum', 'Bitcoin', 'Polygon']
```

---

## Migration Guide

### From AddressDeriver

**Before:**
```typescript
import { AddressDeriver } from '@/chains/AddressDeriver'

const chainEnum = AddressDeriver.mapStringToChain('ethereum')
```

**After:**
```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'

const chainEnum = ChainConfig.getChainEnum('ethereum')
```

---

### From BalanceService Helper Methods

**Before:**
```typescript
// In BalanceService.ts
private getDecimalsForChain(chainId: string): number {
  switch (chainId) {
    case 'Ethereum': return 18
    case 'Bitcoin': return 8
    // ...
  }
}
```

**After:**
```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'

const decimals = ChainConfig.getDecimals(chainId)
```

---

### From Hardcoded Chain Lists

**Before:**
```typescript
// In ChainStrategyFactory.ts
const evmChains = [
  'Ethereum', 'Arbitrum', 'Base', 'Blast',
  'Optimism', 'Zksync', 'Polygon', 'BSC',
  'Avalanche', 'Mantle', 'CronosChain'
]
```

**After:**
```typescript
import { ChainConfig } from '@/chains/config/ChainConfig'

const evmChains = ChainConfig.getEvmChains()
```

---

## Benefits of ChainConfig

### 1. Single Source of Truth
All chain metadata in one place, eliminating duplication and inconsistencies.

### 2. Easy to Extend
Adding a new chain requires updating only ChainConfig - no need to modify multiple files.

### 3. Type Safety
Strong TypeScript types ensure correct usage throughout the codebase.

### 4. Data-Driven Architecture
Factory and services consume chain lists from ChainConfig, not hardcoded values.

### 5. Flexible Identification
Case-insensitive lookup with aliases improves developer experience.

### 6. Better Validation
Built-in validation methods help catch unsupported chains early.

---

## Best Practices

### 1. Always Use ChainConfig for Chain Metadata
Don't hardcode decimals, symbols, or chain lists anywhere else.

```typescript
// ❌ Bad
const decimals = chainId === 'Ethereum' ? 18 : 8

// ✅ Good
const decimals = ChainConfig.getDecimals(chainId)
```

### 2. Normalize Chain IDs Early
Convert user input to official chain IDs as soon as possible.

```typescript
// ✅ Good
const officialId = ChainConfig.getChainId(userInput)
// Now use officialId everywhere
```

### 3. Use Type Checks for Chain-Specific Logic
Instead of string comparison, use type methods.

```typescript
// ❌ Bad
if (chainId === 'Ethereum' || chainId === 'Polygon' || chainId === 'Base') {
  // EVM logic
}

// ✅ Good
if (ChainConfig.isEvmChain(chainId)) {
  // EVM logic
}
```

### 4. Validate User Input
Always validate chain lists from users/config files.

```typescript
const { valid, invalid } = ChainConfig.validateChains(userChains)
if (invalid.length > 0) {
  throw new Error(`Unsupported chains: ${invalid.join(', ')}`)
}
```

---

## Summary

ChainConfig is a foundational architectural improvement that:
- Centralizes chain metadata into a single registry
- Replaces AddressDeriver, BalanceService helpers, and hardcoded chain lists
- Provides flexible, case-insensitive chain identification with aliases
- Enables data-driven factory registration
- Makes adding new chains simpler and safer

**When adding or working with chains, always start with ChainConfig.**
