# Adding New Chains Guide

**Date:** 2025-10-28
**Version:** 1.0
**Target Audience:** SDK Developers

---

## Overview

This guide provides step-by-step instructions for adding support for new blockchain chains to the Vultisig SDK. After the architecture refactoring, adding a new chain is straightforward: implement the `ChainStrategy` interface and register it with the factory.

**Time Estimate:** 2-5 days depending on chain complexity

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Step-by-Step Guide](#step-by-step-guide)
4. [Chain Strategy Template](#chain-strategy-template)
5. [Example: Adding Polkadot](#example-adding-polkadot)
6. [Testing Checklist](#testing-checklist)
7. [Common Patterns](#common-patterns)
8. [Troubleshooting](#troubleshooting)

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

Read these documents first:
- [ARCHITECTURE_REFACTOR_PROPOSAL.md](./ARCHITECTURE_REFACTOR_PROPOSAL.md)
- [ARCHITECTURE_REFACTOR_IMPLEMENTATION.md](./ARCHITECTURE_REFACTOR_IMPLEMENTATION.md)

---

## Architecture Overview

### How Chain Support Works

```
User calls vault.balance('NewChain')
  ↓
Vault uses BalanceService
  ↓
BalanceService asks ChainStrategyFactory for 'NewChain' strategy
  ↓
Factory returns NewChainStrategy instance
  ↓
BalanceService calls strategy.getBalance()
  ↓
NewChainStrategy implements chain-specific logic
  ↓
Returns balance to user
```

**Key Point:** You only need to implement `ChainStrategy` interface. The rest of the SDK handles routing automatically.

---

### What You Need to Implement

**Required:**
1. `ChainStrategy` implementation
2. Address derivation logic
3. Balance fetching logic
4. Transaction parsing logic
5. Keysign payload building

**Optional:**
6. Gas estimation (if chain has gas)
7. Token support (if chain supports tokens)
8. Protocol parsers (DEX, NFT, etc.)

---

## Step-by-Step Guide

### Step 1: Create Chain Folder Structure

Create a new folder for your chain:

```bash
mkdir -p packages/sdk/src/chains/[your-chain-name]
cd packages/sdk/src/chains/[your-chain-name]
```

**Recommended Structure:**
```
chains/[your-chain-name]/
├── index.ts                    # Exports only strategy and types
├── [YourChain]Strategy.ts      # Main strategy implementation
├── types.ts                    # Type definitions
├── config.ts                   # Chain configuration & constants
├── keysign.ts                  # Keysign payload builders
├── parsers/
│   └── transaction.ts          # Transaction parser
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
  // Add chain-specific fields
  [key: string]: any
}

/**
 * Transaction type identifiers
 */
export enum [YourChain]TransactionType {
  Transfer = 'transfer',
  Contract = 'contract',
  // Add chain-specific types
}

/**
 * Options for keysign payload
 */
export interface [YourChain]KeysignOptions {
  skipBroadcast?: boolean
  // Add chain-specific options
}

// Add more types as needed
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

// Network endpoints (if needed)
export const [YOUR_CHAIN]_RPC_ENDPOINTS = {
  mainnet: 'https://rpc.yourchain.com',
  testnet: 'https://testnet-rpc.yourchain.com'
}

// Address prefix or format info
export const [YOUR_CHAIN]_ADDRESS_PREFIX = 'your-prefix'

// Native token info
export const [YOUR_CHAIN]_NATIVE_TOKEN = {
  symbol: 'YCH',
  decimals: 18,
  name: 'YourChain Token'
}

// Helper functions
export function isValidAddress(address: string): boolean {
  // Implement address validation
  return /^your-chain-address-regex$/.test(address)
}

export function normalizeAddress(address: string): string {
  // Implement address normalization (e.g., checksum, lowercase)
  return address.toLowerCase()
}
```

---

### Step 4: Implement Transaction Parser

**File:** `chains/[your-chain-name]/parsers/transaction.ts`

```typescript
import { WalletCore } from '@trustwallet/wallet-core'
import { Parsed[YourChain]Transaction, [YourChain]TransactionType } from '../types'

/**
 * Parse raw [YourChain] transaction
 * @param walletCore WalletCore instance
 * @param rawTx Raw transaction data (format depends on chain)
 */
export async function parse[YourChain]Transaction(
  walletCore: WalletCore,
  rawTx: string | Buffer | Uint8Array
): Promise<Parsed[YourChain]Transaction> {
  // Step 1: Decode transaction based on chain's encoding format
  // (e.g., protobuf, RLP, CBOR, etc.)

  // Step 2: Extract fields
  const from = extractFromAddress(rawTx)
  const to = extractToAddress(rawTx)
  const amount = extractAmount(rawTx)
  const fee = extractFee(rawTx)

  // Step 3: Determine transaction type
  const type = determineTransactionType(rawTx)

  // Step 4: Return parsed transaction
  return {
    type,
    from,
    to,
    amount,
    fee,
    // Add chain-specific fields
    rawTransaction: rawTx
  }
}

// Helper functions
function extractFromAddress(rawTx: any): string {
  // Implement extraction logic
  throw new Error('Not implemented')
}

function extractToAddress(rawTx: any): string {
  // Implement extraction logic
  throw new Error('Not implemented')
}

function extractAmount(rawTx: any): string {
  // Implement extraction logic
  throw new Error('Not implemented')
}

function extractFee(rawTx: any): string {
  // Implement extraction logic
  throw new Error('Not implemented')
}

function determineTransactionType(rawTx: any): string {
  // Implement type determination
  return [YourChain]TransactionType.Transfer
}
```

---

### Step 5: Implement Keysign Payload Builder

**File:** `chains/[your-chain-name]/keysign.ts`

```typescript
import { Parsed[YourChain]Transaction, [YourChain]KeysignOptions } from './types'
import { KeysignPayload } from '../strategies/ChainStrategy'

/**
 * Build keysign payload for [YourChain] transaction
 */
export async function build[YourChain]KeysignPayload(options: {
  parsedTransaction: Parsed[YourChain]Transaction
  rawTransaction: string | Buffer
  vaultPublicKey: string
  skipBroadcast?: boolean
}): Promise<KeysignPayload> {
  const { parsedTransaction, rawTransaction, vaultPublicKey, skipBroadcast } = options

  // Build chain-specific keysign payload
  return {
    vaultPublicKey,
    transaction: typeof rawTransaction === 'string'
      ? rawTransaction
      : Buffer.from(rawTransaction).toString('hex'),
    chain: '[YourChain]',
    skipBroadcast: skipBroadcast ?? false,

    // Add chain-specific fields
    [your-chain]Specific: {
      from: parsedTransaction.from,
      to: parsedTransaction.to,
      amount: parsedTransaction.amount.toString(),
      fee: parsedTransaction.fee.toString()
      // Add more as needed
    }
  }
}

/**
 * Extract chain-specific data from keysign payload
 */
export function get[YourChain]Specific(payload: KeysignPayload): any {
  return payload.[your-chain]Specific
}
```

---

### Step 6: Implement ChainStrategy

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
import { Balance } from '../../types'
import { SmartBalanceResolver } from '../../vault/balance/blockchair/integration'
import { parse[YourChain]Transaction } from './parsers/transaction'
import { build[YourChain]KeysignPayload } from './keysign'
import { Parsed[YourChain]Transaction } from './types'

// Import core utilities
import { getPublicKey, deriveAddress } from '@core/address'

/**
 * Strategy implementation for [YourChain]
 */
export class [YourChain]Strategy implements ChainStrategy {
  readonly chainId = '[YourChain]'

  /**
   * Derive [YourChain] address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Get public key (specify correct key type for your chain)
    // Common types: ECDSA (secp256k1), Ed25519, secp256r1
    const publicKey = getPublicKey({
      chain: this.chainId,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
      derivePath: "m/44'/[coin-type]'/0'/0/0"  // Use correct BIP44 coin type
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: this.chainId,
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for [YourChain] address
   */
  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    // Try Blockchair if available (if Blockchair supports your chain)
    if (balanceResolver) {
      try {
        return await balanceResolver.getBalance(this.chainId, address)
      } catch (error) {
        console.warn(`Blockchair not available for ${this.chainId}, using RPC`)
      }
    }

    // Fallback to RPC
    return this.getBalanceViaRpc(address)
  }

  /**
   * Get balance via RPC
   */
  private async getBalanceViaRpc(address: string): Promise<Balance> {
    // Option 1: Use core's getCoinBalance if chain is supported
    const { getCoinBalance } = require('@core/balance')
    return getCoinBalance(this.chainId, address)

    // Option 2: Implement custom RPC call
    // const rpcEndpoint = [YOUR_CHAIN]_RPC_ENDPOINTS.mainnet
    // const response = await fetch(rpcEndpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     method: 'your_chain_getBalance',
    //     params: [address],
    //     id: 1
    //   })
    // })
    // const data = await response.json()
    // return {
    //   chain: this.chainId,
    //   address,
    //   value: data.result.balance,
    //   decimals: [YOUR_CHAIN]_NATIVE_TOKEN.decimals,
    //   symbol: [YOUR_CHAIN]_NATIVE_TOKEN.symbol
    // }
  }

  /**
   * Parse [YourChain] transaction
   */
  async parseTransaction(rawTx: any): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    const parsed = await parse[YourChain]Transaction(walletCore, rawTx)
    return parsed as ParsedTransaction
  }

  /**
   * Build keysign payload for [YourChain] transaction
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const chainTx = tx as Parsed[YourChain]Transaction

    return build[YourChain]KeysignPayload({
      parsedTransaction: chainTx,
      rawTransaction: chainTx.rawTransaction || '',
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast ?? false
    })
  }

  /**
   * Estimate gas (optional - implement if chain has gas concept)
   */
  async estimateGas?(tx: any): Promise<any> {
    // Implement gas estimation if applicable
    throw new Error('Gas estimation not supported for [YourChain]')
  }

  /**
   * Get WalletCore instance
   */
  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
```

---

### Step 7: Create Index File

**File:** `chains/[your-chain-name]/index.ts`

```typescript
// Only export the strategy and public types
export { [YourChain]Strategy } from './[YourChain]Strategy'
export type {
  Parsed[YourChain]Transaction,
  [YourChain]TransactionType,
  [YourChain]KeysignOptions
} from './types'

// Everything else (parsers, utilities, config) is internal
// Internal code can still import them directly:
// import { parse[YourChain]Transaction } from './parsers/transaction'
```

---

### Step 8: Register Strategy in Factory

**File:** `chains/strategies/ChainStrategyFactory.ts`

Update the `createDefaultStrategyFactory` function:

```typescript
export function createDefaultStrategyFactory(): ChainStrategyFactory {
  const factory = new ChainStrategyFactory()

  // Existing registrations...
  const { EvmStrategy } = require('../evm/EvmStrategy')
  const { SolanaStrategy } = require('../solana/SolanaStrategy')

  // Add your new chain
  const { [YourChain]Strategy } = require('../[your-chain-name]/[YourChain]Strategy')

  // Register EVM chains
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId))

  // Register Solana
  factory.register('Solana', new SolanaStrategy())

  // Register your new chain
  factory.register('[YourChain]', new [YourChain]Strategy())

  return factory
}
```

---

### Step 9: Add to Supported Chains

**File:** `VultisigSDK.ts` (if needed)

Add your chain to the supported chains list:

```typescript
getSupportedChains(): string[] {
  return [
    'Ethereum',
    'Arbitrum',
    'Base',
    'Solana',
    '[YourChain]',  // Add here
    // ... other chains
  ]
}
```

---

### Step 10: Write Tests

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
      publicKeys: {
        // Mock public keys
      },
      hexChainCode: 'mock-chain-code'
    }
  })

  describe('deriveAddress', () => {
    it('should derive valid [YourChain] address', async () => {
      const address = await strategy.deriveAddress(mockVault)

      // Validate address format
      expect(address).toMatch(/^[your-chain-address-regex]$/)
    })
  })

  describe('getBalance', () => {
    it('should fetch balance for address', async () => {
      const mockAddress = '[valid-test-address]'

      const balance = await strategy.getBalance(mockAddress)

      expect(balance).toHaveProperty('chain', '[YourChain]')
      expect(balance).toHaveProperty('address', mockAddress)
      expect(balance).toHaveProperty('value')
      expect(balance).toHaveProperty('decimals')
    })

    it('should use Blockchair when available', async () => {
      const mockResolver = {
        getBalance: jest.fn().mockResolvedValue({
          chain: '[YourChain]',
          value: '1000000000',
          decimals: 18
        })
      }

      const balance = await strategy.getBalance('mock-address', mockResolver)

      expect(mockResolver.getBalance).toHaveBeenCalledWith('[YourChain]', 'mock-address')
    })
  })

  describe('parseTransaction', () => {
    it('should parse raw transaction', async () => {
      const rawTx = '[mock-raw-transaction]'

      const parsed = await strategy.parseTransaction(rawTx)

      expect(parsed).toHaveProperty('type')
      expect(parsed).toHaveProperty('from')
      expect(parsed).toHaveProperty('to')
    })
  })

  describe('buildKeysignPayload', () => {
    it('should build keysign payload', async () => {
      const mockTx = {
        type: 'transfer',
        from: '[from-address]',
        to: '[to-address]',
        amount: '1000000000'
      }

      const payload = await strategy.buildKeysignPayload(
        mockTx,
        'mock-public-key'
      )

      expect(payload).toHaveProperty('vaultPublicKey', 'mock-public-key')
      expect(payload).toHaveProperty('chain', '[YourChain]')
      expect(payload).toHaveProperty('transaction')
    })
  })
})
```

---

## Chain Strategy Template

Complete template you can copy and fill in:

```typescript
// chains/[your-chain-name]/[YourChain]Strategy.ts

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

// TODO: Import your parsers and utilities
// import { parse[YourChain]Transaction } from './parsers/transaction'
// import { build[YourChain]KeysignPayload } from './keysign'

export class [YourChain]Strategy implements ChainStrategy {
  readonly chainId = '[YourChain]'

  async deriveAddress(vault: CoreVault): Promise<string> {
    // TODO: Implement address derivation
    throw new Error('Not implemented')
  }

  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    // TODO: Implement balance fetching
    throw new Error('Not implemented')
  }

  async parseTransaction(rawTx: any): Promise<ParsedTransaction> {
    // TODO: Implement transaction parsing
    throw new Error('Not implemented')
  }

  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    // TODO: Implement keysign payload building
    throw new Error('Not implemented')
  }

  // Optional: Implement if chain has gas
  async estimateGas?(tx: any): Promise<any> {
    throw new Error('Gas estimation not supported')
  }

  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
```

---

## Example: Adding Polkadot

Let's walk through a complete example of adding Polkadot support.

### Step 1: Create Folder Structure

```bash
mkdir -p packages/sdk/src/chains/polkadot/parsers
cd packages/sdk/src/chains/polkadot
```

### Step 2: Define Types

```typescript
// chains/polkadot/types.ts

export interface ParsedPolkadotTransaction {
  type: string
  from: string
  to: string
  amount: string
  tip: string
  era: number
  nonce: number
  signature?: string
  rawTransaction?: string | Buffer
}

export enum PolkadotTransactionType {
  Transfer = 'transfer',
  Bond = 'bond',
  Unbond = 'unbond',
  Nominate = 'nominate'
}
```

### Step 3: Create Config

```typescript
// chains/polkadot/config.ts

export const POLKADOT_CHAIN_ID = 0  // Polkadot chain ID
export const POLKADOT_SS58_PREFIX = 0  // Polkadot address prefix

export const POLKADOT_RPC_ENDPOINTS = {
  mainnet: 'https://rpc.polkadot.io',
  testnet: 'https://westend-rpc.polkadot.io'
}

export const POLKADOT_NATIVE_TOKEN = {
  symbol: 'DOT',
  decimals: 10,
  name: 'Polkadot'
}

export function isValidPolkadotAddress(address: string): boolean {
  // Polkadot uses SS58 address format
  return /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(address)
}
```

### Step 4: Transaction Parser

```typescript
// chains/polkadot/parsers/transaction.ts

import { WalletCore } from '@trustwallet/wallet-core'
import { ParsedPolkadotTransaction, PolkadotTransactionType } from '../types'

export async function parsePolkadotTransaction(
  walletCore: WalletCore,
  rawTx: string | Buffer | Uint8Array
): Promise<ParsedPolkadotTransaction> {
  // Polkadot transactions are SCALE-encoded
  const txBytes = typeof rawTx === 'string'
    ? Buffer.from(rawTx, 'hex')
    : Buffer.from(rawTx)

  // Use WalletCore to decode if available
  // Or use @polkadot/api for parsing
  const { decodeExtrinsic } = require('@polkadot/api')
  const decoded = decodeExtrinsic(txBytes)

  return {
    type: PolkadotTransactionType.Transfer,
    from: decoded.signer.toString(),
    to: decoded.method.args.dest.toString(),
    amount: decoded.method.args.value.toString(),
    tip: decoded.tip.toString(),
    era: decoded.era.asMortalEra.period.toNumber(),
    nonce: decoded.nonce.toNumber(),
    rawTransaction: txBytes
  }
}
```

### Step 5: Keysign Builder

```typescript
// chains/polkadot/keysign.ts

import { ParsedPolkadotTransaction } from './types'
import { KeysignPayload } from '../strategies/ChainStrategy'

export async function buildPolkadotKeysignPayload(options: {
  parsedTransaction: ParsedPolkadotTransaction
  rawTransaction: string | Buffer
  vaultPublicKey: string
  skipBroadcast?: boolean
}): Promise<KeysignPayload> {
  const { parsedTransaction, rawTransaction, vaultPublicKey, skipBroadcast } = options

  return {
    vaultPublicKey,
    transaction: typeof rawTransaction === 'string'
      ? rawTransaction
      : Buffer.from(rawTransaction).toString('hex'),
    chain: 'Polkadot',
    skipBroadcast: skipBroadcast ?? false,
    polkadotSpecific: {
      from: parsedTransaction.from,
      to: parsedTransaction.to,
      amount: parsedTransaction.amount,
      tip: parsedTransaction.tip,
      era: parsedTransaction.era,
      nonce: parsedTransaction.nonce
    }
  }
}
```

### Step 6: Polkadot Strategy

```typescript
// chains/polkadot/PolkadotStrategy.ts

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
import { parsePolkadotTransaction } from './parsers/transaction'
import { buildPolkadotKeysignPayload } from './keysign'
import { ParsedPolkadotTransaction } from './types'
import { POLKADOT_RPC_ENDPOINTS, POLKADOT_NATIVE_TOKEN } from './config'

export class PolkadotStrategy implements ChainStrategy {
  readonly chainId = 'Polkadot'

  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Polkadot uses Sr25519 or Ed25519
    const publicKey = await this.derivePublicKey(vault, walletCore)

    // Use WalletCore or @polkadot/util-crypto
    const { encodeAddress } = require('@polkadot/util-crypto')
    return encodeAddress(publicKey, 0)  // 0 = Polkadot SS58 prefix
  }

  async getBalance(
    address: string,
    balanceResolver?: SmartBalanceResolver
  ): Promise<Balance> {
    // Polkadot not on Blockchair, use RPC
    return this.getBalanceViaRpc(address)
  }

  private async getBalanceViaRpc(address: string): Promise<Balance> {
    // Use @polkadot/api
    const { ApiPromise, WsProvider } = require('@polkadot/api')

    const provider = new WsProvider(POLKADOT_RPC_ENDPOINTS.mainnet)
    const api = await ApiPromise.create({ provider })

    const { data: balance } = await api.query.system.account(address)

    await api.disconnect()

    return {
      chain: 'Polkadot',
      address,
      value: balance.free.toString(),
      decimals: POLKADOT_NATIVE_TOKEN.decimals,
      symbol: POLKADOT_NATIVE_TOKEN.symbol
    }
  }

  async parseTransaction(rawTx: any): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    return parsePolkadotTransaction(walletCore, rawTx)
  }

  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const polkadotTx = tx as ParsedPolkadotTransaction
    return buildPolkadotKeysignPayload({
      parsedTransaction: polkadotTx,
      rawTransaction: polkadotTx.rawTransaction || '',
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast
    })
  }

  private async derivePublicKey(vault: CoreVault, walletCore: WalletCore) {
    // Implementation depends on your key derivation setup
    // This is a simplified example
    const { getPublicKey } = require('@core/address')
    return getPublicKey({
      chain: 'Polkadot',
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
      derivePath: "m/44'/354'/0'/0/0"  // Polkadot coin type: 354
    })
  }

  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
```

### Step 7: Export

```typescript
// chains/polkadot/index.ts

export { PolkadotStrategy } from './PolkadotStrategy'
export type {
  ParsedPolkadotTransaction,
  PolkadotTransactionType
} from './types'
```

### Step 8: Register

```typescript
// chains/strategies/ChainStrategyFactory.ts

const { PolkadotStrategy } = require('../polkadot/PolkadotStrategy')
factory.register('Polkadot', new PolkadotStrategy())
```

### Step 9: Test

```typescript
// Usage
const vault = await sdk.getVault('my-vault', 'password')
const dotAddress = await vault.address('Polkadot')
const dotBalance = await vault.balance('Polkadot')
```

---

## Testing Checklist

### Unit Tests

- [ ] Strategy constructor works
- [ ] `deriveAddress()` returns valid address format
- [ ] `getBalance()` returns balance object with correct fields
- [ ] `parseTransaction()` parses raw transaction correctly
- [ ] `buildKeysignPayload()` builds payload with all required fields
- [ ] Error handling works (invalid inputs, network errors)

### Integration Tests

- [ ] Address derivation matches reference implementation
- [ ] Balance matches blockchain explorer
- [ ] Parsed transaction matches known test vectors
- [ ] Keysign payload validates correctly

### End-to-End Tests

- [ ] Create vault with new chain
- [ ] Derive address for new chain
- [ ] Fetch balance for new chain
- [ ] Sign transaction for new chain (testnet)
- [ ] Broadcast transaction (testnet)

---

## Common Patterns

### Pattern 1: Chains with Similar Format (e.g., EVM forks)

If your chain is similar to an existing one, you can extend the strategy:

```typescript
export class YourEvmForkStrategy extends EvmStrategy {
  constructor() {
    super('YourChain')
    // Override specific behavior
  }

  async getBalance(address: string): Promise<Balance> {
    // Custom balance logic
    return super.getBalance(address)
  }
}
```

### Pattern 2: Chains with Tokens

Add token support methods:

```typescript
export class YourChainStrategy implements ChainStrategy {
  // ... base implementation

  async getTokenBalance(
    address: string,
    tokenAddress: string
  ): Promise<Balance> {
    // Implement token balance fetching
  }

  async getTokenMetadata(tokenAddress: string): Promise<TokenMetadata> {
    // Fetch token name, symbol, decimals
  }
}
```

### Pattern 3: Chains with Multiple Address Formats

Support different address formats:

```typescript
export class YourChainStrategy implements ChainStrategy {
  async deriveAddress(
    vault: CoreVault,
    format?: 'legacy' | 'segwit' | 'native-segwit'
  ): Promise<string> {
    const publicKey = await this.getPublicKey(vault)

    switch (format || 'native-segwit') {
      case 'legacy':
        return this.toLegacyAddress(publicKey)
      case 'segwit':
        return this.toSegwitAddress(publicKey)
      case 'native-segwit':
        return this.toNativeSegwitAddress(publicKey)
    }
  }
}
```

---

## Troubleshooting

### Issue: Address Doesn't Match Reference Implementation

**Solution:**
- Verify derivation path (BIP44 coin type)
- Check key type (ECDSA vs Ed25519 vs Sr25519)
- Verify address encoding (base58, bech32, SS58, etc.)
- Check address prefix/version bytes

### Issue: Balance Always Returns Zero

**Solution:**
- Verify RPC endpoint is correct
- Check network (mainnet vs testnet)
- Verify address format is correct
- Check RPC method name and parameters
- Test with known address that has balance

### Issue: Transaction Parsing Fails

**Solution:**
- Verify transaction encoding format
- Check if transaction is signed vs unsigned
- Verify you're decoding the right fields
- Test with known test vectors from chain documentation

### Issue: Keysign Fails

**Solution:**
- Verify all required fields are in payload
- Check field types (string vs number vs bigint)
- Verify signature algorithm matches chain
- Check transaction hash computation

---

## Resources

### Chain Documentation

Research these for your target chain:
- Transaction format specification
- Address format specification
- RPC API documentation
- BIP44 coin type
- Cryptographic algorithms used

### Useful Libraries

- `@trustwallet/wallet-core` - Multi-chain support
- Chain-specific SDK (e.g., `@polkadot/api`, `@solana/web3.js`)
- Crypto libraries (e.g., `@noble/secp256k1`, `tweetnacl`)

### Testing Resources

- Chain testnet/devnet
- Faucets for test tokens
- Block explorers
- Test vectors from chain documentation

---

## Checklist Summary

### Implementation

- [ ] Create chain folder structure
- [ ] Define types (types.ts)
- [ ] Create configuration (config.ts)
- [ ] Implement transaction parser (parsers/transaction.ts)
- [ ] Implement keysign builder (keysign.ts)
- [ ] Implement ChainStrategy ([YourChain]Strategy.ts)
- [ ] Create index file (index.ts)
- [ ] Register in ChainStrategyFactory
- [ ] Add to supported chains list

### Testing

- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Test on testnet
- [ ] Verify against block explorer

### Documentation

- [ ] Add chain to README
- [ ] Document any chain-specific features
- [ ] Add examples
- [ ] Update changelog

---

## Getting Help

If you encounter issues:

1. Check existing chain implementations (EVM, Solana) for reference
2. Review the architecture documentation
3. Check chain's official documentation
4. Open an issue with:
   - Chain name
   - What you've tried
   - Error messages
   - Relevant code snippets

---

**Document Status:** Complete
**Last Updated:** 2025-10-28
**Version:** 1.0
