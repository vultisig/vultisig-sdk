---
name: vultisig-sdk
description: TypeScript SDK for MPC wallet integration across 36+ blockchains. Create wallets, import from seedphrase, sign transactions, execute swaps, scan for security threats, and more. Supports Bitcoin, Ethereum, Solana, and 33+ other chains with threshold signing security.
version: 1.0.0
author: Vultisig
repository: https://github.com/vultisig/vultisig-sdk
metadata:
  openclaw:
    emoji: "🛡️"
    homepage: https://github.com/vultisig/vultisig-sdk
    requires:
      bins:
        - node
        - npm
    install:
      npm: "@vultisig/sdk"
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
---

# Vultisig SDK

TypeScript SDK for Vultisig MPC wallet operations. See the [router skill](../SKILL.md) for an overview of MPC benefits and to choose between CLI and SDK.

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

**Requirements:**
- Node.js 20+
- TypeScript (recommended)
- Platforms: Node.js, Browser (with WASM), React Native, Electron

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

// Seedphrase
await sdk.validateSeedphrase(mnemonic)
await sdk.discoverChainsFromSeedphrase(mnemonic, chains?, onProgress?)
await sdk.createFastVaultFromSeedphrase({ mnemonic, name, email, password })
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

## All Capabilities

For full details and code examples, see the [SDK Users Guide](../../docs/SDK-USERS-GUIDE.md).

| Capability | Description | Guide Section |
|-----------|-------------|---------------|
| Vault Creation | FastVault (2-of-2) and SecureVault (N-of-M) | [Vault Management](../../docs/SDK-USERS-GUIDE.md#vault-management) |
| Seedphrase Import | Validate mnemonics, discover chains, create vaults from seedphrase | [Seedphrase](../../docs/SDK-USERS-GUIDE.md#creating-vaults-from-seedphrase) |
| Send Transactions | Prepare, sign, broadcast for all 36+ chains | [Essential Operations](../../docs/SDK-USERS-GUIDE.md#essential-operations) |
| Token Swaps | Cross-chain (THORChain), same-chain (1inch, LiFi), ERC-20 approval handling | [Token Swaps](../../docs/SDK-USERS-GUIDE.md#token-swaps) |
| Sign Arbitrary Bytes | Custom tx construction with signBytes and broadcastRawTx | [Signing](../../docs/SDK-USERS-GUIDE.md#signing-arbitrary-bytes) |
| Cosmos Signing | SignAmino and SignDirect for Cosmos dApps | [Cosmos Signing](../../docs/SDK-USERS-GUIDE.md#cosmos-signing-signamino--signdirect) |
| Gas Estimation | Get gas info per chain via `vault.gas(chain)` | [Gas Estimation](../../docs/SDK-USERS-GUIDE.md#gas-estimation) |
| Token Discovery | Look up known tokens, discover at address, resolve metadata | [Token Registry](../../docs/SDK-USERS-GUIDE.md#token-registry--discovery) |
| Price Feeds | CoinGecko token prices via `vault.getPrice()` | [Price Feeds](../../docs/SDK-USERS-GUIDE.md#price-feeds) |
| Security Scanning | Site scanning, transaction validation, transaction simulation | [Security](../../docs/SDK-USERS-GUIDE.md#security-scanning) |
| Fiat On-Ramp | Buy crypto via Banxa integration | [Fiat On-Ramp](../../docs/SDK-USERS-GUIDE.md#fiat-on-ramp-banxa) |
| Portfolio Value | Fiat valuations across all chains | [Portfolio](../../docs/SDK-USERS-GUIDE.md#portfolio-value) |
| Password Management | Callbacks, caching, manual lock/unlock | [Password Management](../../docs/SDK-USERS-GUIDE.md#password-management) |
| Event System | Reactive updates for balances, signing, chains, tokens | [Events](../../docs/SDK-USERS-GUIDE.md#event-system) |
| Caching | Address, balance, password, portfolio caching with configurable TTLs | [Caching](../../docs/SDK-USERS-GUIDE.md#caching-system) |
| Error Handling | Typed VaultError with error codes (PasswordRequired, InsufficientBalance, etc.) | [Quick Reference](../../docs/SDK-USERS-GUIDE.md#quick-reference) |
| Stateless Mode | MemoryStorage for serverless, testing, one-off operations | [Stateless Usage](../../docs/SDK-USERS-GUIDE.md#stateless-usage) |
| Multi-Platform | Node.js, Browser (WASM), React Native, Electron | [Platform Notes](../../docs/SDK-USERS-GUIDE.md#platform-notes) |
| Storage Options | FileStorage, BrowserStorage, MemoryStorage, or custom | [Configuration](../../docs/SDK-USERS-GUIDE.md#configuration) |

## Supported Chains

36+ blockchains:
- **EVM (13)**: Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, Blast, Cronos, ZkSync, Hyperliquid, Mantle, Sei
- **UTXO (6)**: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash
- **Cosmos (10)**: Cosmos, THORChain, MayaChain, Osmosis, Dydx, Kujira, Terra, Terra Classic, Noble, Akash
- **Other (7)**: Solana, Sui, Polkadot, TON, Ripple, Tron, Cardano

## Resources

- [SDK Users Guide](../../docs/SDK-USERS-GUIDE.md) - Complete documentation with examples
- [GitHub Repository](https://github.com/vultisig/vultisig-sdk)
