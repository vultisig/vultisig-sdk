# Adding New Chains Guide

**Last Updated:** 2025-10-30
**Version:** 2.0

---

## Overview

This guide provides step-by-step instructions for adding support for new blockchain chains to the Vultisig SDK. Adding a new chain is straightforward: implement the `ChainStrategy` interface and register it with the factory.

**Time Estimate:** 2-5 days depending on chain complexity

---

## Prerequisites

### Knowledge Requirements
- Understanding of the target blockchain
- TypeScript/JavaScript proficiency
- Familiarity with cryptographic concepts (keys, signatures)
- Understanding of the chain's transaction format

### Technical Requirements
- Target chain RPC endpoint access
- Chain documentation (transaction format, address format, etc.)
- Test network access for testing
- Block explorer for verification

### SDK Understanding
Before starting, read:
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Understand the SDK architecture
- [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) - Understand the ChainConfig system (required for adding chains)

---

## Quick Start

### What You Need to Implement

**Required:**
1. `ChainStrategy` implementation
2. Address derivation logic
3. Balance fetching logic
4. Transaction parsing logic
5. Keysign payload building
6. Pre-signing hash computation
7. Signature result formatting

**Optional:**
8. Gas estimation (if chain has gas)
9. Token support (if chain supports tokens)
10. Protocol parsers (DEX, NFT, etc.)

---

## Step-by-Step Guide

### Step 1: Create Chain Folder Structure

```bash
mkdir -p packages/sdk/src/chains/[your-chain-name]
cd packages/sdk/src/chains/[your-chain-name]
```

**Recommended Structure:**
```
chains/[your-chain-name]/
├── index.ts                       # Exports only strategy and types
├── [YourChain]Strategy.ts         # Main strategy implementation
├── types.ts                       # Type definitions
├── config.ts                      # Chain configuration & constants
└── __tests__/
    └── [YourChain]Strategy.test.ts
```

---

### Step 2: Define Types

**File:** `chains/[your-chain-name]/types.ts`

```typescript
/**
 * Parsed transaction for [YourChain]
 */
export interface Parsed[YourChain]Transaction {
  type: string
  from: string
  to: string
  amount: string | bigint
  fee: string | bigint
  rawTransaction?: string | Buffer
  // Add chain-specific fields
}

/**
 * Transaction type identifiers
 */
export enum [YourChain]TransactionType {
  Transfer = 'transfer',
  Contract = 'contract',
  // Add chain-specific types
}
```

---

### Step 3: Create Configuration

**File:** `chains/[your-chain-name]/config.ts`

```typescript
/**
 * Chain configuration and constants
 */

// Chain ID or network identifier
export const [YOUR_CHAIN]_CHAIN_ID = 'your-chain-mainnet-id'

// Network endpoints
export const [YOUR_CHAIN]_RPC_ENDPOINTS = {
  mainnet: 'https://rpc.yourchain.com',
  testnet: 'https://testnet-rpc.yourchain.com'
}

// Native token info
export const [YOUR_CHAIN]_NATIVE_TOKEN = {
  symbol: 'YCH',
  decimals: 18,
  name: 'YourChain Token'
}

// Helper functions
export function isValidAddress(address: string): boolean {
  return /^your-chain-address-regex$/.test(address)
}
```

---

### Step 4: Implement ChainStrategy

**File:** `chains/[your-chain-name]/[YourChain]Strategy.ts`

```typescript
import { CoreVault } from '@core/vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance, Signature } from '../../types'
import { SmartBalanceResolver } from '../../vault/balance/blockchair/integration'

export class [YourChain]Strategy implements ChainStrategy {
  readonly chainId = '[YourChain]'

  /**
   * Derive address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Use @core helpers for address derivation
    const { getPublicKey } = require('@core/chain/publicKey/getPublicKey')
    const { deriveAddress } = require('@core/chain/publicKey/address/deriveAddress')

    const publicKey = getPublicKey({
      chain: this.chainId,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
      derivePath: "m/44'/[coin-type]'/0'/0/0"  // Use correct BIP44 coin type
    })

    return deriveAddress({
      chain: this.chainId,
      publicKey,
      walletCore
    })
  }

  /**
   * Get balance for address
   */
  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    // Try Blockchair if available (for UTXO chains)
    if (balanceResolver) {
      try {
        return await balanceResolver.getBalance(this.chainId, address)
      } catch (error) {
        console.warn(`Blockchair not available for ${this.chainId}, using RPC`)
      }
    }

    // Fallback to RPC or use core's getCoinBalance
    const { getCoinBalance } = require('@core/chain/coin/balance')
    return getCoinBalance(this.chainId, address)
  }

  /**
   * Parse transaction
   */
  async parseTransaction(rawTx: any): Promise<ParsedTransaction> {
    // Implement chain-specific parsing
    // Extract: from, to, amount, fee, type
    // Return ParsedTransaction object
    throw new Error('Not implemented')
  }

  /**
   * Build keysign payload
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    return {
      vaultPublicKey,
      transaction: tx.rawTransaction?.toString() || '',
      chain: this.chainId,
      skipBroadcast: options?.skipBroadcast ?? false,
      // Add chain-specific data
      [yourChain]Specific: {
        from: tx.from,
        to: tx.to,
        amount: tx.amount.toString()
      }
    }
  }

  /**
   * Compute pre-signing hashes (for MPC signing)
   */
  async computePreSigningHashes(
    payload: KeysignPayload,
    vault: CoreVault,
    walletCore: WalletCore
  ): Promise<string[]> {
    // Compute message hashes that need to be signed
    // For most chains: single hash
    // For UTXO: one hash per input

    // Example for single-message chains:
    const txHash = this.computeTransactionHash(payload.transaction)
    return [txHash]
  }

  /**
   * Format signature result (after MPC signing)
   */
  async formatSignatureResult(
    signatureResults: Record<string, string>,
    payload: KeysignPayload
  ): Promise<Signature> {
    // Take MPC signature results and format for broadcast
    const signatures = Object.values(signatureResults)

    // Apply chain-specific signature formatting
    const signedTx = this.attachSignatureToTransaction(
      payload.transaction,
      signatures[0]
    )

    return {
      signedTransaction: signedTx,
      signatures: signatures,
      chain: this.chainId
    }
  }

  /**
   * Estimate gas (optional - implement if chain has gas)
   */
  async estimateGas?(tx: any): Promise<any> {
    throw new Error('Gas estimation not supported for [YourChain]')
  }

  // Private helper methods
  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }

  private computeTransactionHash(rawTx: string): string {
    // Implement chain-specific hash computation
    throw new Error('Not implemented')
  }

  private attachSignatureToTransaction(rawTx: string, signature: string): string {
    // Implement chain-specific signature attachment
    throw new Error('Not implemented')
  }
}
```

---

### Step 5: Create Index File

**File:** `chains/[your-chain-name]/index.ts`

```typescript
// Only export the strategy and public types
export { [YourChain]Strategy } from './[YourChain]Strategy'
export type {
  Parsed[YourChain]Transaction,
  [YourChain]TransactionType
} from './types'
```

---

### Step 6: Register Chain in ChainConfig

**File:** `chains/config/ChainConfig.ts`

**IMPORTANT:** This step is required for your chain to be recognized by the SDK. ChainConfig is the single source of truth for chain metadata.

Add your chain to the `registry` object:

```typescript
export class ChainConfig {
  private static readonly registry: Record<string, ChainMetadata> = {
    // ... existing chains ...

    // Add your new chain:
    yournewchain: {
      id: 'YourChain',                       // Official PascalCase ID (must match chainId in strategy)
      chainEnum: Chain.YourChain,            // From @core/chain/Chain
      decimals: 18,                          // Native token decimals
      symbol: 'YCH',                         // Native token symbol
      type: 'evm',                           // Chain type: 'evm' | 'utxo' | 'cosmos' | 'other'
      aliases: ['yournewchain', 'ych'],      // Lowercase aliases for flexible lookup
    },
  }
}
```

**Chain Type Guidelines:**
- Use `'evm'` for Ethereum Virtual Machine compatible chains (reuse EvmStrategy)
- Use `'utxo'` for Bitcoin-like chains (reuse UtxoStrategy)
- Use `'cosmos'` for Cosmos SDK-based chains (CosmosStrategy not yet implemented)
- Use `'other'` for unique chains requiring custom strategy

**Tips:**
- The `id` field must match your strategy's `chainId` property exactly
- Add common aliases to improve developer experience (e.g., 'eth' for 'Ethereum')
- Verify decimals carefully - this affects all balance calculations
- For EVM chains, most use 18 decimals

See [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) for complete documentation.

---

### Step 7: Register Strategy in Factory

**File:** `chains/strategies/ChainStrategyFactory.ts`

Update the `createDefaultStrategyFactory` function:

```typescript
import { ChainConfig } from '../config/ChainConfig'

export function createDefaultStrategyFactory(): ChainStrategyFactory {
  const factory = new ChainStrategyFactory()

  // Import strategies
  const { EvmStrategy } = require('../evm/EvmStrategy')
  const { UtxoStrategy } = require('../utxo/UtxoStrategy')
  const { SolanaStrategy } = require('../solana/SolanaStrategy')
  const { [YourChain]Strategy } = require('../[your-chain-name]/[YourChain]Strategy')

  // Register EVM chains dynamically from ChainConfig
  const evmChains = ChainConfig.getEvmChains()
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))

  // Register UTXO chains dynamically from ChainConfig
  const utxoChains = ChainConfig.getUtxoChains()
  factory.registerUtxoChains(utxoChains, (chainId) => new UtxoStrategy(chainId))

  // Register Solana
  factory.register('Solana', new SolanaStrategy())

  // Register your new chain (if type is 'other' and not EVM/UTXO)
  factory.register('YourChain', new [YourChain]Strategy())

  return factory
}
```

**Note:** If your chain is type `'evm'` or `'utxo'` in ChainConfig, it will be automatically registered with the respective strategy. You only need to manually register chains with type `'other'` that require custom strategies.

---

### Step 8: Write Tests

**File:** `chains/[your-chain-name]/__tests__/[YourChain]Strategy.test.ts`

```typescript
import { [YourChain]Strategy } from '../[YourChain]Strategy'
import { CoreVault } from '@core/vault'

describe('[YourChain]Strategy', () => {
  let strategy: [YourChain]Strategy
  let mockVault: CoreVault

  beforeEach(() => {
    strategy = new [YourChain]Strategy()
    mockVault = {
      publicKeys: { /* mock keys */ },
      hexChainCode: 'mock-chain-code'
    }
  })

  describe('deriveAddress', () => {
    it('should derive valid address', async () => {
      const address = await strategy.deriveAddress(mockVault)
      expect(address).toMatch(/^[your-chain-address-regex]$/)
    })
  })

  describe('getBalance', () => {
    it('should fetch balance', async () => {
      const balance = await strategy.getBalance('[test-address]')
      expect(balance).toHaveProperty('chain', '[YourChain]')
      expect(balance).toHaveProperty('value')
    })
  })

  describe('parseTransaction', () => {
    it('should parse raw transaction', async () => {
      const parsed = await strategy.parseTransaction('[mock-tx]')
      expect(parsed).toHaveProperty('from')
      expect(parsed).toHaveProperty('to')
    })
  })

  describe('computePreSigningHashes', () => {
    it('should compute message hashes', async () => {
      const payload = { /* mock payload */ }
      const hashes = await strategy.computePreSigningHashes(
        payload,
        mockVault,
        mockWalletCore
      )
      expect(hashes).toBeInstanceOf(Array)
      expect(hashes.length).toBeGreaterThan(0)
    })
  })

  describe('formatSignatureResult', () => {
    it('should format signed transaction', async () => {
      const mockSignatures = { '0': 'mock-signature' }
      const mockPayload = { transaction: 'mock-tx', chain: '[YourChain]' }

      const result = await strategy.formatSignatureResult(
        mockSignatures,
        mockPayload
      )

      expect(result).toHaveProperty('signedTransaction')
      expect(result).toHaveProperty('chain', '[YourChain]')
    })
  })
})
```

---

## Key Implementation Points

### 1. Address Derivation
- Use correct BIP44 coin type from [SLIP-0044](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
- Choose correct key type (ECDSA secp256k1, Ed25519, secp256r1)
- Apply correct address encoding (base58, bech32, SS58, etc.)

### 2. Balance Fetching
- Try Blockchair first for UTXO chains (faster)
- Fall back to RPC for unsupported chains
- Use `@core/chain/coin/balance` helpers when available
- ChainConfig automatically provides decimals and symbols for balance formatting

### 3. Transaction Parsing
- Decode based on chain's encoding (RLP, SCALE, protobuf, etc.)
- Extract all required fields: from, to, amount, fee
- Preserve raw transaction for signing

### 4. Pre-Signing Hashes
- **Critical for MPC signing:** Compute exact message hashes
- Single hash for most chains (Ethereum, Solana)
- Multiple hashes for UTXO (one per input)
- Must match exactly what the chain expects

### 5. Signature Formatting
- Take raw MPC signatures and format for chain
- Apply signature format (DER, compact, raw)
- Attach signature to transaction
- Return broadcast-ready signed transaction

---

## Common Patterns

### Pattern 1: EVM-Compatible Chains

If your chain is EVM-compatible, you can reuse `EvmStrategy`:

```typescript
// Just register with EvmStrategy
factory.register('YourEvmChain', new EvmStrategy('YourEvmChain'))
```

### Pattern 2: Single-Message Signing (Most Chains)

```typescript
async computePreSigningHashes(payload, vault, walletCore): Promise<string[]> {
  const hash = this.hashTransaction(payload.transaction)
  return [hash]  // Single message
}
```

### Pattern 3: Multi-Message Signing (UTXO)

```typescript
async computePreSigningHashes(payload, vault, walletCore): Promise<string[]> {
  const utxoData = payload.utxoSpecific
  const hashes: string[] = []

  // One hash per input
  for (const input of utxoData.inputs) {
    const hash = this.hashInput(input)
    hashes.push(hash)
  }

  return hashes  // Multiple messages
}
```

### Pattern 4: Chains with Tokens

Add token support methods to your strategy:

```typescript
async getTokenBalance(
  address: string,
  tokenAddress: string
): Promise<Balance> {
  // Implement token balance fetching
}
```

---

## Testing Checklist

### Unit Tests
- [ ] `deriveAddress()` returns valid address format
- [ ] `getBalance()` returns balance with correct fields
- [ ] `parseTransaction()` parses correctly
- [ ] `computePreSigningHashes()` returns valid hashes
- [ ] `formatSignatureResult()` formats correctly
- [ ] Error handling works

### Integration Tests
- [ ] Address matches reference implementation
- [ ] Balance matches blockchain explorer
- [ ] Transaction parsing matches test vectors
- [ ] Signing flow works end-to-end

### End-to-End Tests
- [ ] Create vault with new chain
- [ ] Derive address
- [ ] Fetch balance
- [ ] Sign transaction on testnet
- [ ] Broadcast transaction

---

## Troubleshooting

### Address Doesn't Match Expected
- Verify BIP44 coin type
- Check key type (ECDSA vs Ed25519)
- Verify address encoding (base58, bech32, etc.)
- Check address prefix/version bytes

### Balance Returns Zero
- Verify RPC endpoint
- Check network (mainnet vs testnet)
- Test with known address with balance
- Verify RPC method and parameters

### Transaction Parsing Fails
- Verify encoding format
- Check if transaction is signed vs unsigned
- Test with known test vectors

### Signing Fails
- Verify pre-signing hash computation
- Check signature algorithm matches chain
- Verify all payload fields are present
- Test signature formatting

---

## Example Implementations

For reference, see existing implementations:

- **EVM Chains:** [EvmStrategy.ts](../../packages/sdk/src/chains/evm/EvmStrategy.ts)
- **Solana:** [SolanaStrategy.ts](../../packages/sdk/src/chains/solana/SolanaStrategy.ts)
- **UTXO Chains:** [UtxoStrategy.ts](../../packages/sdk/src/chains/utxo/UtxoStrategy.ts)

---

## Implementation Checklist

- [ ] Create chain folder structure
- [ ] Define types (types.ts)
- [ ] Create configuration (config.ts)
- [ ] Implement ChainStrategy
- [ ] Implement `deriveAddress()`
- [ ] Implement `getBalance()`
- [ ] Implement `parseTransaction()`
- [ ] Implement `buildKeysignPayload()`
- [ ] Implement `computePreSigningHashes()`
- [ ] Implement `formatSignatureResult()`
- [ ] Create index file (index.ts)
- [ ] **Register chain in ChainConfig.ts (REQUIRED)**
- [ ] Register strategy in ChainStrategyFactory (if type is 'other')
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Test on testnet
- [ ] Update documentation

---

## Getting Help

If you encounter issues:

1. Check existing chain implementations for reference
2. Review [ARCHITECTURE.md](./ARCHITECTURE.md)
3. Check chain's official documentation
4. Open an issue with:
   - Chain name
   - What you've tried
   - Error messages
   - Relevant code snippets

---

**Ready to implement?** Start with Step 1!
