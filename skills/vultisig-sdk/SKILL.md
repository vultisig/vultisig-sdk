---
name: vultisig-sdk
description: TypeScript SDK for MPC wallet integration across 36+ blockchains
version: 1.0.0
author: Vultisig
repository: https://github.com/vultisig/vultisig-sdk
tags:
  - crypto
  - wallet
  - mpc
  - typescript
  - sdk
  - defi
  - bitcoin
  - ethereum
  - solana
  - polygon
  - arbitrum
  - optimism
  - base
  - avalanche
  - bsc
  - litecoin
  - dogecoin
  - cosmos
  - thorchain
  - mayachain
  - osmosis
  - dydx
  - kujira
  - sui
  - polkadot
  - ton
  - ripple
  - tron
  - cardano
  - zcash
  - dash
  - blast
  - cronos
  - zksync
  - hyperliquid
  - mantle
  - sei
  - terra
  - noble
  - akash
  - bitcoin-cash
---

# Vultisig SDK

TypeScript SDK for secure multi-party computation (MPC) wallet operations across 36+ blockchains.

## Why MPC Wallets for AI Agents

Traditional wallets store a single private key or seed phrase - if compromised, all funds are lost. MPC (Multi-Party Computation) wallets eliminate this single point of failure:

- **No single key to steal**: Private keys are split across multiple parties using cryptographic secret sharing
- **Threshold security**: 2-of-2 or N-of-M signing means compromising one party isn't enough to steal funds
- **No seed phrase exposure**: Unlike traditional wallets, no mnemonic is stored in plaintext anywhere
- **Automation-friendly**: FastVault enables instant server-assisted signing perfect for AI agents and bots
- **Programmable trust**: Choose between speed (FastVault) or maximum security (SecureVault)
- **Audit trail**: All signing operations require explicit multi-party coordination

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

**Requirements:**
- Node.js 20+
- TypeScript (recommended)

## Quick Start

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

// Initialize SDK
const sdk = new Vultisig({
  onPasswordRequired: async (vaultId, vaultName) => {
    return process.env.VAULT_PASSWORD || ''
  },
  passwordCache: { defaultTTL: 300000 } // 5 minutes
})
await sdk.initialize()

// Create a FastVault
const vaultId = await sdk.createFastVault({
  name: 'agent-wallet',
  email: 'agent@example.com',
  password: 'SecurePassword123!'
})

// Verify with email code
const vault = await sdk.verifyVault(vaultId, 'verification-code')

// Get address
const address = await vault.address(Chain.Ethereum)
console.log('ETH address:', address)

// Check balance
const balance = await vault.balance(Chain.Ethereum)
console.log(`Balance: ${balance.amount} ${balance.symbol}`)

// Clean up
sdk.dispose()
```

## Vault Types

| Type | Threshold | Signing | Best For |
|------|-----------|---------|----------|
| **FastVault** | 2-of-2 (device + server) | Instant | AI agents, automation |
| **SecureVault** | N-of-M (configurable) | Multi-device coordination | Teams, high security |

**For AI agents, FastVault is recommended** - instant signing without coordination.

## Core Classes

### Vultisig (Main Entry Point)

```typescript
const sdk = new Vultisig({
  storage?: Storage,                    // Default: FileStorage (Node) / BrowserStorage
  defaultChains?: Chain[],              // Chains for new vaults
  defaultCurrency?: string,             // Fiat currency (default: 'USD')
  onPasswordRequired?: (id, name) => Promise<string>,
  passwordCache?: { defaultTTL: number }
})

// Lifecycle
await sdk.initialize()
sdk.dispose()

// Vault creation
const vaultId = await sdk.createFastVault({ name, email, password })
const vault = await sdk.verifyVault(vaultId, code)
const { vault } = await sdk.createSecureVault({ name, devices, threshold })

// Vault management
const vaults = await sdk.listVaults()
const vault = await sdk.getActiveVault()
await sdk.setActiveVault(vault)
await sdk.deleteVault(vault)

// Import/Export
const vault = await sdk.importVault(vultContent, password)
const isEncrypted = sdk.isVaultEncrypted(vultContent)
```

### VaultBase (Shared Vault Methods)

```typescript
// Properties
vault.id: string
vault.name: string
vault.type: 'fast' | 'secure'
vault.isEncrypted: boolean

// Addresses
const address = await vault.address(Chain.Bitcoin)
const addresses = await vault.addresses([Chain.Bitcoin, Chain.Ethereum])

// Balances
const balance = await vault.balance(Chain.Ethereum)
const balances = await vault.balances()  // All chains
await vault.updateBalance(Chain.Ethereum)  // Force refresh

// Transactions
const payload = await vault.prepareSendTx({ coin, receiver, amount })
const signature = await vault.sign(payload)
const txHash = await vault.broadcastTx({ chain, keysignPayload: payload, signature })

// Swaps
const quote = await vault.getSwapQuote({ fromCoin, toCoin, amount })
const { keysignPayload } = await vault.prepareSwapTx({ fromCoin, toCoin, amount, swapQuote })

// Management
await vault.addChain(Chain.Solana)
await vault.removeChain(Chain.Litecoin)
await vault.rename('New Name')
const { filename, data } = await vault.export(password)
```

### Chain Enum

```typescript
import { Chain } from '@vultisig/sdk'

// EVM
Chain.Ethereum, Chain.Polygon, Chain.BSC, Chain.Arbitrum, Chain.Optimism,
Chain.Base, Chain.Avalanche, Chain.Blast, Chain.CronosChain, Chain.ZkSync,
Chain.Hyperliquid, Chain.Mantle, Chain.Sei

// UTXO
Chain.Bitcoin, Chain.Litecoin, Chain.Dogecoin, Chain.BitcoinCash,
Chain.Dash, Chain.Zcash

// Cosmos
Chain.Cosmos, Chain.THORChain, Chain.MayaChain, Chain.Osmosis, Chain.Dydx,
Chain.Kujira, Chain.Terra, Chain.TerraClassic, Chain.Noble, Chain.Akash

// Other
Chain.Solana, Chain.Sui, Chain.Polkadot, Chain.Ton, Chain.Ripple,
Chain.Tron, Chain.Cardano
```

## Key Operations

### Send Transaction

```typescript
import { Chain, AccountCoin } from '@vultisig/sdk'

const coin: AccountCoin = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  address: await vault.address(Chain.Ethereum),
  decimals: 18,
  isNativeToken: true
}

// Prepare transaction
const payload = await vault.prepareSendTx({
  coin,
  receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  amount: '100000000000000000' // 0.1 ETH in wei
})

// Sign
const signature = await vault.sign(payload)

// Broadcast
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: payload,
  signature
})
```

### Swap Tokens

```typescript
// Get quote
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1  // 0.1 ETH
})

console.log(`Output: ${quote.estimatedOutput} BTC`)

// Prepare swap transaction
const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1,
  swapQuote: quote
})

// Handle ERC-20 approval if needed
if (approvalPayload) {
  const approvalSig = await vault.sign(approvalPayload)
  await vault.broadcastTx({ chain: Chain.Ethereum, keysignPayload: approvalPayload, signature: approvalSig })
}

// Execute swap
const signature = await vault.sign(keysignPayload)
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload,
  signature
})
```

### Sign Arbitrary Bytes

```typescript
// For custom transaction construction
const signature = await vault.signBytes({
  data: '0xabcdef...',  // Uint8Array, Buffer, or hex string
  chain: Chain.Ethereum
})

// signature.signature = hex-encoded signature
// signature.recovery = recovery byte (ECDSA only)
```

### Broadcast Raw Transaction

```typescript
// For externally-constructed transactions
const txHash = await vault.broadcastRawTx({
  chain: Chain.Ethereum,
  rawTx: '0x02f8...'  // Signed transaction hex
})
```

## Event System

Subscribe to vault events for reactive updates:

```typescript
// Balance updates
vault.on('balanceUpdated', ({ chain, tokenId }) => {
  console.log(`Balance updated: ${chain}`)
})

// Transaction events
vault.on('transactionSigned', ({ chain, txHash }) => {
  console.log(`Signed: ${txHash}`)
})

vault.on('transactionBroadcast', ({ chain, txHash }) => {
  console.log(`Broadcast: ${txHash}`)
})

// Signing progress
vault.on('signingProgress', ({ step, progress, message }) => {
  console.log(`${message} (${progress}%)`)
})

// Unsubscribe
vault.off('balanceUpdated', handler)
```

## Storage Options

```typescript
import { Vultisig, FileStorage, MemoryStorage, BrowserStorage } from '@vultisig/sdk'

// Node.js (default)
const sdk = new Vultisig()  // Uses FileStorage (~/.vultisig)

// Custom path
const sdk = new Vultisig({
  storage: new FileStorage('/custom/path')
})

// In-memory (stateless, testing)
const sdk = new Vultisig({
  storage: new MemoryStorage()
})

// Browser
const sdk = new Vultisig()  // Uses BrowserStorage (IndexedDB)
```

## Password Management

```typescript
const sdk = new Vultisig({
  // Callback when password needed
  onPasswordRequired: async (vaultId, vaultName) => {
    return await promptUserForPassword(vaultName)
  },

  // Cache password for 5 minutes
  passwordCache: { defaultTTL: 300000 }
})

// Manual lock/unlock
await vault.unlock('password')
await vault.lock()

// Check status
if (vault.isUnlocked()) {
  // Password is cached
}
```

## Error Handling

```typescript
import { VaultError, VaultErrorCode } from '@vultisig/sdk'

try {
  await vault.sign(payload)
} catch (error) {
  if (error instanceof VaultError) {
    switch (error.code) {
      case VaultErrorCode.PasswordRequired:
        // Prompt for password
        break
      case VaultErrorCode.InsufficientBalance:
        // Not enough funds
        break
      case VaultErrorCode.BroadcastFailed:
        // Network error
        break
    }
  }
}
```

## Supported Chains

36+ blockchains:
- **EVM (13)**: Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, Blast, Cronos, ZkSync, Hyperliquid, Mantle, Sei
- **UTXO (6)**: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash
- **Cosmos (10)**: Cosmos, THORChain, MayaChain, Osmosis, Dydx, Kujira, Terra, Terra Classic, Noble, Akash
- **Other (7)**: Solana, Sui, Polkadot, TON, Ripple, Tron, Cardano

See [references/chains.md](references/chains.md) for full details.

## Resources

- [GitHub Repository](https://github.com/vultisig/vultisig-sdk)
- [Full SDK Documentation](https://github.com/vultisig/vultisig-sdk/blob/main/docs/SDK-USERS-GUIDE.md)
- [API Reference](references/api-reference.md)
- [Code Examples](references/examples.md)
