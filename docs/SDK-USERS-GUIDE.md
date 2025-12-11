# Vultisig SDK Users Guide

> **⚠️ Alpha Release**: This SDK is currently in alpha development. APIs may change without notice. Use in production at your own risk.

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Quick Start Tutorial](#quick-start-tutorial)
- [Core Concepts](#core-concepts)
- [Password Management](#password-management)
- [Vault Management](#vault-management)
- [Essential Operations](#essential-operations)
- [Token Swaps](#token-swaps)
- [Configuration](#configuration)
- [Caching System](#caching-system)
- [Event System](#event-system)
- [Quick Reference](#quick-reference)
- [Platform Notes](#platform-notes)

---

## Installation & Setup

### Install the Package

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

### Platform Requirements

- **Node.js**: Version 20 or higher
- **Browser**: Modern browsers with WebAssembly support (Chrome, Firefox, Safari, Edge)
- **TypeScript**: Optional but recommended

### Browser Setup: WASM Files

For browser environments, you need to serve the WASM files from your public directory:

1. Copy WASM files to your public directory:
   ```bash
   cp node_modules/@vultisig/sdk/dist/*.wasm public/
   ```

2. The SDK will automatically load these files from the root path (`/`)

### Basic Initialization

The SDK automatically uses the appropriate storage for your platform:
- **Node.js**: `FileStorage` (stores in `~/.vultisig` by default)
- **Browser**: `BrowserStorage` (uses IndexedDB with localStorage fallback)

```typescript
import { Vultisig } from '@vultisig/sdk'

const sdk = new Vultisig()  // Storage is auto-configured for your platform

await sdk.initialize()

// When done, clean up resources
sdk.dispose()
```

**Custom Storage (optional):**

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'

const sdk = new Vultisig({
  storage: new MemoryStorage(),  // Override with custom storage
})

await sdk.initialize()
sdk.dispose()
```

---

## Quick Start Tutorial

Here's a complete example showing vault creation, address derivation, and balance checking with password management:

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

// Step 1: Initialize SDK with configuration
const sdk = new Vultisig({
  // Password handling (recommended for production)
  onPasswordRequired: async (vaultId: string, vaultName: string) => {
    // Prompt user for password - implementation depends on platform
    return await promptUserForPassword(`Enter password for ${vaultName}`)
  },

  passwordCache: {
    defaultTTL: 300000  // Cache password for 5 minutes
  }
})

await sdk.initialize()

// Step 2: Create a fast vault (server-assisted, always encrypted)
// Returns the vaultId - vault is returned from verifyVault()
const vaultId = await sdk.createFastVault({
  name: "My Wallet",
  email: "user@example.com",
  password: "SecurePassword123!",
  onProgress: (step) => {
    console.log(`${step.message} (${step.progress}%)`)
  }
})

// Step 3: Verify with email code and get the vault
// The vault is saved to storage and returned after successful verification
const code = await getVerificationCode() // Get code from user
const vault = await sdk.verifyVault(vaultId, code)

// Step 4: Now use the vault
const btcAddress = await vault.address(Chain.Bitcoin)
console.log('Bitcoin address:', btcAddress)

// Step 5: Check balance
const balance = await vault.balance(Chain.Bitcoin)
console.log(`Balance: ${balance.amount} ${balance.symbol}`)

// Step 6: Get balances across multiple chains
const balances = await vault.balances([Chain.Bitcoin, Chain.Ethereum])
for (const [chain, balance] of Object.entries(balances)) {
  console.log(`${chain}: ${balance.amount} ${balance.symbol}`)
}

// Step 7: Clean up when done
sdk.dispose()
```

---

## Core Concepts

### Vault Types

The SDK supports two types of vaults:

- **FastVault**: 2-of-2 MPC with VultiServer assistance. Always encrypted with password. Best for quick setup and individual use.
- **SecureVault** *(Coming Soon)*: Multi-device MPC without server. Optionally encrypted. Best for maximum security and multi-device scenarios.

### Supported Chains

The SDK supports 40+ blockchains across multiple ecosystems:

- **EVM**: Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, Blast, Cronos, ZkSync
- **UTXO**: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash
- **Cosmos**: Cosmos Hub, THORChain, MayaChain, Osmosis, Dydx, Kujira, Terra
- **Other**: Solana, Polkadot, Sui, TON, Ripple, Tron, Cardano

See the [Quick Reference](#supported-chains) section for the complete list.

### Storage Layer

The SDK uses platform-appropriate storage by default:

- **Node.js**: `FileStorage` - Stores vaults in `~/.vultisig` directory
- **Browser**: `BrowserStorage` - Uses IndexedDB with localStorage fallback
- **Fallback**: `MemoryStorage` - In-memory only (data lost on restart)

For custom persistence, implement the `Storage` interface:

```typescript
type Storage = {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  list(): Promise<string[]>
  clear(): Promise<void>
  getUsage?(): Promise<number>
  getQuota?(): Promise<number | undefined>
}
```

### Stateless Usage

For scenarios where you don't need persistent storage—such as one-off operations, testing, or serverless functions—use `MemoryStorage` to create ephemeral vault instances:

```typescript
import { Vultisig, MemoryStorage, Chain } from '@vultisig/sdk'
import * as fs from 'fs'

// Create SDK with in-memory storage (no persistence)
const sdk = new Vultisig({
  storage: new MemoryStorage()
})
await sdk.initialize()

// Load vault from file
const vultContent = fs.readFileSync('my-wallet.vult', 'utf-8')
const vault = await sdk.importVault(vultContent, 'password123')

// Use vault normally - all operations work
const address = await vault.address(Chain.Bitcoin)
const balance = await vault.balance(Chain.Ethereum)
const signature = await vault.sign(payload)

// When the process ends, all state is lost (by design)
sdk.dispose()
```

**Use cases for stateless usage:**
- **One-off signing**: Sign a transaction without persisting vault state
- **Address derivation**: Generate addresses without storing vault data
- **Testing**: Unit and integration tests without filesystem side effects
- **Serverless functions**: Lambda/Cloud Functions that load vault per-request
- **CLI tools**: Command-line utilities that operate on vault files

**What works in stateless mode:**
- ✅ Address derivation
- ✅ Balance checking
- ✅ Transaction signing (FastVault)
- ✅ Gas estimation
- ✅ Swap quotes and execution
- ✅ Token/chain management (in-memory only)

**What doesn't persist:**
- ❌ Vault preferences (chains, tokens, currency)
- ❌ Cached balances/addresses (recreated each session)
- ❌ Password cache (must provide password each time)

**Note**: The vault file (`.vult`) itself is never modified by the SDK—it's read-only. Persistence is about SDK metadata and cached data, not the vault file contents.

---

## Password Management

Password management is a critical aspect of the SDK. FastVaults are always encrypted, and proper password handling ensures both security and good user experience.

### When Passwords Are Required

- **FastVault**: Always encrypted, password required for all operations
- **SecureVault**: Optional encryption, password only required if encrypted
- **Import**: Password required if the vault file is encrypted
- **Export**: Password optional, encrypts the backup file

### Setting Up Password Callback

Configure a password callback when creating your SDK instance to automatically prompt users when needed:

#### Browser Example (with Modal)

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'

const sdk = new Vultisig({
  storage: new MemoryStorage(),
  onPasswordRequired: async (vaultId: string, vaultName: string) => {
    return new Promise((resolve) => {
      // Show modal to user
      const modal = createPasswordModal({
        title: `Enter password for ${vaultName}`,
        onSubmit: (password) => {
          closeModal()
          resolve(password)
        }
      })
      modal.show()
    })
  }
})
```

#### Node.js Example (Command Line)

```typescript
import { Vultisig } from '@vultisig/sdk'
import * as readline from 'readline'

const sdk = new Vultisig({
  storage: new FileStorage(),
  onPasswordRequired: async (vaultId: string, vaultName: string) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve) => {
      rl.question(`Enter password for ${vaultName}: `, (password) => {
        rl.close()
        resolve(password)
      })
    })
  }
})
```

#### Retrieve from Secure Storage

```typescript
const sdk = new Vultisig({
  storage: new FileStorage(),
  onPasswordRequired: async (vaultId: string, vaultName: string) => {
    // Retrieve from OS keychain, secure enclave, etc.
    return await secureStorage.getPassword(vaultId)
  }
})
```

### Password Caching

Cache passwords to avoid repeated prompts during a session:

```typescript
const sdk = new Vultisig({
  storage: new MemoryStorage(),
  passwordCache: {
    defaultTTL: 300000  // Cache for 5 minutes (in milliseconds)
  }
})
```

Common TTL configurations:

```typescript
// 5 minutes (recommended for balance of security and UX)
passwordCache: { defaultTTL: 300000 }

// 15 minutes
passwordCache: { defaultTTL: 900000 }

// 1 hour
passwordCache: { defaultTTL: 3600000 }

// Session only (no expiry, cleared on app close)
passwordCache: { defaultTTL: Infinity }
```

### Manual Lock/Unlock

Control password cache manually for sensitive operations:

```typescript
// Lock the vault (clear cached password)
await vault.lock()

// Check if vault is unlocked
if (!vault.isUnlocked()) {
  // Manually unlock with password
  await vault.unlock('SecurePassword123!')
}

// Perform sensitive operation
const signature = await vault.sign(keysignPayload)

// Lock again after sensitive operation
await vault.lock()
```

**Example: Auto-lock on Inactivity**

```typescript
let inactivityTimer: NodeJS.Timeout | null = null

function resetInactivityTimer(vault: VaultBase) {
  if (inactivityTimer) clearTimeout(inactivityTimer)

  // Lock after 10 minutes of inactivity
  inactivityTimer = setTimeout(async () => {
    await vault.lock()
    console.log('Vault locked due to inactivity')
  }, 600000)
}

// Call resetInactivityTimer() on user interactions
document.addEventListener('click', () => resetInactivityTimer(vault))
document.addEventListener('keypress', () => resetInactivityTimer(vault))
```

### Checking Encryption Status

Before importing a vault, check if it requires a password:

```typescript
import * as fs from 'fs'

const vultContent = fs.readFileSync('backup.vult', 'utf-8')
const isEncrypted = sdk.isVaultEncrypted(vultContent)

let vault
if (isEncrypted) {
  const password = await promptUserForPassword()
  vault = await sdk.importVault(vultContent, password)
} else {
  vault = await sdk.importVault(vultContent)
}
```

### Export with Password

Create encrypted backups with a password (can be different from vault password):

```typescript
// Export with encryption
const { filename, data } = await vault.export('BackupPassword123!')

// Save to file (Node.js)
fs.writeFileSync(filename, data, 'utf-8')
console.log(`Encrypted backup saved to ${filename}`)

// Export without encryption (not recommended for FastVault)
const { filename, data } = await vault.export()
```

### Password Security Best Practices

1. **Never store passwords in plain text**
2. **Use password caching with reasonable TTLs** (5-15 minutes recommended)
3. **Lock vaults after sensitive operations**
4. **Use different passwords for backups**
5. **Implement auto-lock on inactivity**
6. **Clear password cache on logout**
7. **Use secure password input** (type="password" in forms)

---

## Vault Management

### Creating Fast Vaults

Create a new vault with server assistance:

```typescript
// Step 1: Create vault - returns vaultId (vault not returned yet)
const vaultId = await sdk.createFastVault({
  name: "My Wallet",
  email: "user@example.com",
  password: "SecurePassword123!",
  onProgress: (step) => {
    console.log(`Progress: ${step.message} (${step.progress}%)`)
  }
})

// Step 2: Verify with email code - returns the vault
const code = await promptUserForVerificationCode()
const vault = await sdk.verifyVault(vaultId, code)

console.log('Vault created:', vault.name)
```

**Important: Verification Flow**

Fast vaults require email verification. The vault is only returned **after successful verification**:

1. `createFastVault()` generates keys and returns the `vaultId`
2. The vault exists in memory but is **not returned or persisted**
3. User calls `verifyVault(vaultId, code)` with the email verification code
4. On success, the vault is saved to storage, set as active, and **returned**

**If the process is killed before verification completes, the vault is lost.** This is intentional - unverified vaults cannot be used for signing anyway. The user simply needs to call `createFastVault()` again to restart the process.

### Importing Vaults

Import an existing vault from a `.vult` backup file:

```typescript
import * as fs from 'fs'

// Read vault file
const vultContent = fs.readFileSync('MyWallet-local-party-1-share1of2.vult', 'utf-8')

// Check if encrypted
const isEncrypted = sdk.isVaultEncrypted(vultContent)

// Import with password if needed
const vault = await sdk.importVault(
  vultContent,
  isEncrypted ? 'VaultPassword123!' : undefined
)

console.log('Vault imported:', vault.name)
```

### Exporting Vaults

Create a backup of your vault:

```typescript
// Export with password encryption (recommended)
const { filename, data } = await vault.export('BackupPassword123!')

// Save to file (Node.js)
fs.writeFileSync(filename, data, 'utf-8')

// Save to file (Browser)
const blob = new Blob([data], { type: 'text/plain' })
const url = URL.createObjectURL(blob)
const link = document.createElement('a')
link.href = url
link.download = filename
link.click()
URL.revokeObjectURL(url)
```

### Listing Vaults

Get all stored vaults:

```typescript
const vaults = await sdk.listVaults()

for (const vault of vaults) {
  console.log(`${vault.name} (${vault.type})`)
  console.log(`  ID: ${vault.id}`)
  console.log(`  Created: ${new Date(vault.createdAt).toLocaleString()}`)
  console.log(`  Encrypted: ${vault.isEncrypted}`)
}
```

### Switching Vaults

Set the active vault:

```typescript
// Set active vault
await sdk.setActiveVault(vault)

// Get active vault
const activeVault = sdk.getActiveVault()

// Get vault by ID
const vault = await sdk.getVaultById('vault-id-here')
```

### Deleting Vaults

Remove a vault from storage:

```typescript
// Delete specific vault
await sdk.deleteVault(vault)

// Or delete by ID
const vault = await sdk.getVaultById('vault-id')
await sdk.deleteVault(vault)
```

### Renaming Vaults

```typescript
await vault.rename('New Wallet Name')
console.log('Vault renamed to:', vault.name)
```

---

## Essential Operations

### Address Derivation

Get addresses for different blockchains:

```typescript
// Single address
const ethAddress = await vault.address(Chain.Ethereum)
console.log('Ethereum:', ethAddress) // "0x742d35Cc..."

const btcAddress = await vault.address(Chain.Bitcoin)
console.log('Bitcoin:', btcAddress) // "bc1q..."

// Multiple addresses
const addresses = await vault.addresses([
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana
])

console.log(addresses)
// {
//   Bitcoin: "bc1q...",
//   Ethereum: "0x...",
//   Solana: "9Wz..."
// }
```

Addresses are cached automatically for performance.

### Balance Checking

Check balances for your assets:

```typescript
// Single chain balance
const balance = await vault.balance(Chain.Ethereum)
console.log(`${balance.amount} ${balance.symbol}`)
console.log(`Value: $${balance.fiatValue} ${balance.currency}`)

// Multiple chain balances
const balances = await vault.balances([Chain.Bitcoin, Chain.Ethereum])

for (const [chain, balance] of Object.entries(balances)) {
  console.log(`${chain}: ${balance.amount} ${balance.symbol} ($${balance.fiatValue})`)
}

// All configured chains (with tokens)
const allBalances = await vault.balances(undefined, true) // includeTokens=true

// Force refresh (bypass cache)
await vault.updateBalance(Chain.Ethereum)
await vault.updateBalances() // Refresh all chains
```

### Preparing & Sending Transactions

Send transactions on any supported chain:

```typescript
import { AccountCoin } from 'vultisig-sdk'

// Step 1: Get coin information
const coin = new AccountCoin({
  chain: Chain.Ethereum,
  ticker: 'ETH',
  address: await vault.address(Chain.Ethereum),
  decimals: 18,
  priceUSD: '3000.00',
  isNativeToken: true
})

// Step 2: Prepare transaction
const keysignPayload = await vault.prepareSendTx({
  coin,
  receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  amount: '100000000000000000', // 0.1 ETH in wei
  memo: 'Payment for services',
  feeSettings: {
    gasPrice: '50000000000', // 50 gwei (optional, uses estimate if not provided)
  }
})

// Step 3: Sign transaction (may trigger password prompt)
const signature = await vault.sign(keysignPayload)

// Step 4: Broadcast transaction
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload,
  signature
})

console.log('Transaction broadcast:', txHash)
```

### Gas Estimation

Get gas information for transactions:

```typescript
const gasInfo = await vault.gas(Chain.Ethereum)

console.log('Gas Price:', gasInfo.gasPrice)
console.log('Max Priority Fee:', gasInfo.maxPriorityFeePerGas)
console.log('Max Fee:', gasInfo.maxFeePerGas)
```

### Token Management

Add and manage custom tokens:

```typescript
// Add ERC-20 token
await vault.addToken(Chain.Ethereum, {
  id: 'usdt',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  chainId: 'ethereum'
})

// Get tokens for a chain
const tokens = vault.getTokens(Chain.Ethereum)

for (const token of tokens) {
  console.log(`${token.symbol}: ${token.contractAddress}`)
}

// Check token balance
const usdtBalance = await vault.balance(Chain.Ethereum, 'usdt')

// Remove token
await vault.removeToken(Chain.Ethereum, 'usdt')
```

### Chain Management

Manage which chains are active for the vault:

```typescript
// Add a chain
await vault.addChain(Chain.Polygon)

// Add multiple chains
await vault.setChains([
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Polygon,
  Chain.Solana
])

// Remove a chain
await vault.removeChain(Chain.Litecoin)

// Reset to default chains
await vault.resetToDefaultChains()
```

### Portfolio Value

Get total portfolio value in fiat:

```typescript
// Get total value
const totalValue = await vault.getTotalValue('USD')
console.log(`Total portfolio value: $${totalValue}`)

// Get value for specific asset
const ethValue = await vault.getValue(Chain.Ethereum, null, 'USD')

// Force refresh portfolio value
await vault.updateTotalValue()

// Change preferred currency
await vault.setCurrency('EUR')
const totalEur = await vault.getTotalValue()
console.log(`Total portfolio value: €${totalEur}`)
```

---

## Token Swaps

The SDK supports token swaps across multiple chains and protocols, including cross-chain swaps via THORChain and same-chain DEX aggregation via 1inch.

### Supported Swap Routes

| Route Type | Provider | Example |
| ---------- | -------- | ------- |
| Cross-chain (BTC, ETH, Cosmos) | THORChain | BTC → ETH, ETH → ATOM |
| Same-chain EVM | 1inch | ETH → USDC on Ethereum |
| Cross-chain EVM | LiFi | Polygon → Arbitrum |

### Checking Swap Support

```typescript
// Get list of chains that support swaps
const supportedChains = vault.getSupportedSwapChains()
console.log('Swap-enabled chains:', supportedChains)

// Check if specific swap route is available
const canSwap = vault.isSwapSupported(Chain.Ethereum, Chain.Bitcoin)
console.log('ETH → BTC supported:', canSwap) // true
```

### Getting a Swap Quote

Get a quote before executing a swap:

```typescript
// Simple format - just specify chains (native tokens)
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1  // 0.1 ETH
})

console.log(`Provider: ${quote.provider}`)           // e.g., 'thorchain'
console.log(`Output: ${quote.estimatedOutput} BTC`)  // e.g., '0.00234 BTC'
console.log(`Expires: ${new Date(quote.expiresAt)}`)
console.log(`Fees: ${quote.fees.total}`)

// Check if approval is needed (ERC-20 tokens)
if (quote.requiresApproval) {
  console.log(`Approval needed for: ${quote.approvalInfo?.spender}`)
}
```

### Swapping with ERC-20 Tokens

For ERC-20 tokens, specify the token contract address:

```typescript
// Swap USDC to ETH
const quote = await vault.getSwapQuote({
  fromCoin: {
    chain: Chain.Ethereum,
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC
  },
  toCoin: { chain: Chain.Ethereum },  // Native ETH
  amount: 100  // 100 USDC
})

// Or use full AccountCoin format
const ethAddress = await vault.address(Chain.Ethereum)
const quote = await vault.getSwapQuote({
  fromCoin: {
    chain: Chain.Ethereum,
    address: ethAddress,
    id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ticker: 'USDC',
    decimals: 6
  },
  toCoin: {
    chain: Chain.Ethereum,
    address: ethAddress,
    ticker: 'ETH',
    decimals: 18
  },
  amount: 100
})
```

### Executing a Swap

Complete swap flow with signing and broadcasting:

```typescript
// Step 1: Get quote
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1
})

// Step 2: Prepare transaction
const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1,
  swapQuote: quote
})

// Step 3: Handle approval if needed (ERC-20 tokens only)
if (approvalPayload) {
  const approvalSignature = await vault.sign(approvalPayload)
  const approvalTxHash = await vault.broadcastTx({
    chain: Chain.Ethereum,
    keysignPayload: approvalPayload,
    signature: approvalSignature
  })
  console.log('Approval tx:', approvalTxHash)
  // Wait for approval confirmation before proceeding
}

// Step 4: Sign and broadcast swap
const signature = await vault.sign(keysignPayload)
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload,
  signature
})

console.log('Swap tx:', txHash)
```

### Checking Token Allowance

Check if ERC-20 approval is needed before swapping:

```typescript
const ethAddress = await vault.address(Chain.Ethereum)

// Check current allowance for a DEX router
const allowance = await vault.getTokenAllowance(
  {
    chain: Chain.Ethereum,
    address: ethAddress,
    id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
    ticker: 'USDC',
    decimals: 6
  },
  '0x1111111254fb6c44bAC0beD2854e76F90643097d'  // 1inch router
)

console.log(`Current USDC allowance: ${allowance}`)
```

### Swap Events

Subscribe to swap-related events:

```typescript
// Listen for swap quotes
vault.on('swapQuoteReceived', ({ quote }) => {
  console.log(`Quote received from ${quote.provider}`)
  console.log(`Output: ${quote.estimatedOutput}`)
})

// Get quote - event will fire automatically
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1
})
```

### Error Handling

Handle common swap errors gracefully:

```typescript
try {
  const quote = await vault.getSwapQuote({
    fromCoin: { chain: Chain.Ethereum },
    toCoin: { chain: Chain.Bitcoin },
    amount: 0.001  // Very small amount
  })
} catch (error) {
  if (error.message.includes('No swap route')) {
    console.log('No swap route available for this pair/amount')
  } else if (error.message.includes('pool')) {
    console.log('Liquidity pool not available')
  } else {
    throw error
  }
}
```

---

## Configuration

### SDK Instance Configuration

All configuration is passed to the `Vultisig` constructor. The SDK uses instance-scoped configuration (no global state):

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

const sdk = new Vultisig({
  // Required: Storage implementation
  storage: new FileStorage(),  // Or MemoryStorage, or custom implementation

  // Optional: Default chains for new vaults
  defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],

  // Optional: Default fiat currency
  defaultCurrency: 'USD',

  // Optional: Password management
  onPasswordRequired: async (vaultId, vaultName) => {
    return await promptUserForPassword(vaultName)
  },

  // Optional: Password cache settings
  passwordCache: {
    defaultTTL: 300000  // 5 minutes
  },

  // Optional: Cache configuration
  cacheConfig: {
    balanceTTL: 300000,  // 5 minutes (default)
    priceTTL: 300000,    // 5 minutes (default)
  },

  // Optional: Custom server endpoints (advanced)
  serverEndpoints: {
    fastVault: 'https://custom-api.example.com',
    messageRelay: 'https://custom-relay.example.com'
  }
})

await sdk.initialize()

// ... use the SDK ...

// Clean up when done (releases resources)
sdk.dispose()
```

### Multiple SDK Instances

You can create multiple isolated SDK instances, each with its own storage and configuration:

```typescript
// Instance for user 1
const sdk1 = new Vultisig({
  storage: new FileStorage('./user1/vaults'),
  defaultCurrency: 'USD',
})

// Instance for user 2
const sdk2 = new Vultisig({
  storage: new FileStorage('./user2/vaults'),
  defaultCurrency: 'EUR',
})

// Each instance is completely isolated
await sdk1.initialize()
await sdk2.initialize()

// Clean up both when done
sdk1.dispose()
sdk2.dispose()
```

### Custom Storage Implementation

Implement the `Storage` interface for custom persistence:

```typescript
import { Vultisig, type VaultStorage } from '@vultisig/sdk'
import * as fs from 'fs'
import * as path from 'path'

class CustomStorage implements Storage {
  constructor(private basePath: string) {}

  async get(key: string): Promise<string | null> {
    try {
      return fs.readFileSync(path.join(this.basePath, key), 'utf-8')
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    fs.writeFileSync(path.join(this.basePath, key), value, 'utf-8')
  }

  async remove(key: string): Promise<void> {
    fs.unlinkSync(path.join(this.basePath, key))
  }

  async clear(): Promise<void> {
    const files = fs.readdirSync(this.basePath)
    files.forEach(file => fs.unlinkSync(path.join(this.basePath, file)))
  }

  async list(prefix?: string): Promise<string[]> {
    const files = fs.readdirSync(this.basePath)
    return prefix ? files.filter(f => f.startsWith(prefix)) : files
  }
}

// Use custom storage
const sdk = new Vultisig({
  storage: new CustomStorage('./vaults')
})

await sdk.initialize()
// ... use the SDK ...
sdk.dispose()
```

---

## Caching System

The SDK uses a multi-level caching system for optimal performance:

### Address Caching

Addresses are cached indefinitely by default (they never change):

```typescript
// First call - derives address from keys
const address = await vault.address(Chain.Ethereum) // ~100ms

// Subsequent calls - instant from cache
const cachedAddress = await vault.address(Chain.Ethereum) // <1ms
```

Addresses are cached permanently (they never change for a vault) and persisted to storage.

### Balance Caching

Balances are cached to avoid excessive API calls:

```typescript
// First call - fetches from blockchain
const balance = await vault.balance(Chain.Ethereum) // ~500ms

// Within TTL - returns cached value
const cachedBalance = await vault.balance(Chain.Ethereum) // <1ms

// Force refresh
await vault.updateBalance(Chain.Ethereum) // Bypasses cache

// Refresh all balances
await vault.updateBalances() // Bypasses cache for all chains
```

Configure cache TTLs:

```typescript
const sdk = new Vultisig({
  storage: new FileStorage(),
  cacheConfig: {
    balanceTTL: 300000,  // 5 minutes (default)
    priceTTL: 300000,    // 5 minutes (default)
  }
})
```

### Password Caching

Passwords are cached to avoid repeated prompts (see [Password Management](#password-management)):

```typescript
const sdk = new Vultisig({
  storage: new FileStorage(),
  passwordCache: {
    defaultTTL: 300000  // 5 minutes
  }
})

// Manually clear password cache
await vault.lock()

// Check if password is cached
if (vault.isUnlocked()) {
  console.log('Password is cached')
}
```

### Portfolio Value

Total portfolio value is calculated from cached balances and prices:

```typescript
// Calculates from all balances × prices (uses cached values)
const value = await vault.getTotalValue()

// Force refresh prices first, then get total
await vault.updateValues('all')
const freshValue = await vault.getTotalValue()
```

### Cache Invalidation

Caches are automatically invalidated when:

- Balance updated from transaction
- Token added/removed
- Chain added/removed
- Currency changed

Manual cache clearing:

```typescript
// Clear specific balance cache
await vault.updateBalance(Chain.Ethereum)

// Clear all balance caches
await vault.updateBalances()

// Password cache (lock vault)
await vault.lock()
```

---

## Event System

Subscribe to vault events for reactive UIs:

### Available Events

```typescript
// Balance updated
vault.on('balanceUpdated', ({ chain, tokenId }) => {
  console.log(`Balance updated: ${chain}${tokenId ? ':' + tokenId : ''}`)
})

// Transaction broadcast
vault.on('transactionBroadcast', ({ chain, txHash }) => {
  console.log(`Transaction on ${chain}: ${txHash}`)
})

// Chain added
vault.on('chainAdded', ({ chain }) => {
  console.log(`Chain added: ${chain}`)
})

// Chain removed
vault.on('chainRemoved', ({ chain }) => {
  console.log(`Chain removed: ${chain}`)
})

// Token added
vault.on('tokenAdded', ({ chain, token }) => {
  console.log(`Token added on ${chain}: ${token.symbol}`)
})

// Token removed
vault.on('tokenRemoved', ({ chain, tokenId }) => {
  console.log(`Token removed from ${chain}: ${tokenId}`)
})

// Currency changed
vault.on('currencyChanged', ({ currency }) => {
  console.log(`Currency changed to: ${currency}`)
})

// Vault renamed
vault.on('renamed', ({ oldName, newName }) => {
  console.log(`Vault renamed: ${oldName} -> ${newName}`)
})

// Swap quote received
vault.on('swapQuoteReceived', ({ quote }) => {
  console.log(`Swap quote: ${quote.estimatedOutput} via ${quote.provider}`)
})

// Error events
vault.on('error', (error) => {
  console.error('Vault error:', error.message)
})
```

### Event Patterns

**React Example:**

```typescript
import { useEffect, useState } from 'react'

function BalanceDisplay({ vault, chain }) {
  const [balance, setBalance] = useState(null)

  useEffect(() => {
    // Initial load
    vault.balance(chain).then(setBalance)

    // Subscribe to updates
    const handler = ({ chain: updatedChain }) => {
      if (updatedChain === chain) {
        vault.balance(chain).then(setBalance)
      }
    }

    vault.on('balanceUpdated', handler)

    // Cleanup
    return () => vault.off('balanceUpdated', handler)
  }, [vault, chain])

  return <div>{balance?.amount} {balance?.symbol}</div>
}
```

**Unsubscribe from Events:**

```typescript
const handler = (data) => console.log(data)

vault.on('balanceUpdated', handler)

// Later...
vault.off('balanceUpdated', handler)
```

---

## Quick Reference

### Vultisig Class Methods

```typescript
class Vultisig {
  // Constructor - storage is required
  constructor(config: {
    storage: Storage               // Required
    defaultChains?: Chain[]
    defaultCurrency?: string
    onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
    passwordCache?: { defaultTTL: number }
    cacheConfig?: CacheConfig
    serverEndpoints?: { fastVault?: string, messageRelay?: string }
  })

  // Initialization
  initialize(): Promise<void>

  // Cleanup (releases all resources)
  dispose(): void

  // Vault creation (returns vaultId - call verifyVault to get the vault)
  createFastVault(options: {
    name: string
    password: string
    email: string
    onProgress?: (step: VaultCreationStep) => void
  }): Promise<string>

  // Coming Soon - Not yet implemented
  createSecureVault(options: {
    name: string
    password: string
    devices: number
    threshold?: number
    onProgress?: (step: VaultCreationStep) => void
  }): Promise<{ vault: SecureVault, vaultId: string, sessionId: string }>

  // Vault management
  importVault(vultContent: string, password?: string): Promise<VaultBase>
  listVaults(): Promise<VaultBase[]>
  getVaultById(id: string): Promise<VaultBase | null>
  getActiveVault(): Promise<VaultBase | null>
  setActiveVault(vault: VaultBase | null): Promise<void>
  deleteVault(vault: VaultBase): Promise<void>

  // Utilities
  isVaultEncrypted(vultContent: string): boolean
  getServerStatus(): Promise<ServerStatus>

  // Address book
  getAddressBook(chain?: Chain): Promise<AddressBookEntry[]>
  addAddressBookEntry(entries: AddressBookEntry[]): Promise<void>

  // Vault verification (returns the vault on success)
  verifyVault(vaultId: string, code: string): Promise<FastVault>
  resendVaultVerification(vaultId: string): Promise<void>
}
```

### VaultBase Methods

```typescript
class VaultBase {
  // Properties
  id: string
  name: string
  type: 'fast' | 'secure'
  isEncrypted: boolean

  // Vault management
  save(): Promise<void>
  rename(newName: string): Promise<void>
  export(password?: string): Promise<{ filename: string, data: string }>
  delete(): Promise<void>
  lock(): Promise<void>
  unlock(password: string): Promise<void>
  isUnlocked(): boolean

  // Addresses
  address(chain: Chain): Promise<string>
  addresses(chains?: Chain[]): Promise<Record<string, string>>

  // Balances
  balance(chain: Chain, tokenId?: string): Promise<Balance>
  balances(chains?: Chain[], includeTokens?: boolean): Promise<Record<string, Balance>>
  updateBalance(chain: Chain, tokenId?: string): Promise<void>
  updateBalances(chains?: Chain[]): Promise<void>

  // Transactions
  prepareSendTx(params: SendTxParams): Promise<SigningPayload>
  sign(payload: SigningPayload): Promise<Signature>
  broadcastTx(params: BroadcastParams): Promise<string>
  gas(chain: Chain): Promise<GasInfo>

  // Swaps
  getSwapQuote(params: SwapQuoteParams): Promise<SwapQuoteResult>
  prepareSwapTx(params: SwapTxParams): Promise<SwapPrepareResult>
  getTokenAllowance(coin: AccountCoin, spender: string): Promise<bigint>
  getSupportedSwapChains(): readonly Chain[]
  isSwapSupported(fromChain: Chain, toChain: Chain): boolean

  // Chains & Tokens
  setChains(chains: Chain[]): Promise<void>
  addChain(chain: Chain): Promise<void>
  removeChain(chain: Chain): Promise<void>
  resetToDefaultChains(): Promise<void>
  getTokens(chain: Chain): Token[]
  addToken(chain: Chain, token: Token): Promise<void>
  removeToken(chain: Chain, tokenId: string): Promise<void>

  // Portfolio
  getValue(chain: Chain, tokenId?: string, currency?: string): Promise<number>
  getTotalValue(currency?: string): Promise<number>
  updateTotalValue(): Promise<void>
  setCurrency(currency: string): Promise<void>

  // Events
  on(event: string, handler: Function): void
  off(event: string, handler: Function): void
}
```

### Vault Creation Methods

Fast vaults and secure vaults are created through the Vultisig class:

```typescript
// Create fast vault (2-of-2 with server)
// Returns vaultId - call verifyVault to get the vault
const vaultId = await sdk.createFastVault({
  name: string
  email: string
  password: string
  onProgress?: (step: VaultCreationStep) => void
})

// Verify with email code to get the vault (saves and returns it)
const vault = await sdk.verifyVault(vaultId, code)

// Create secure vault (multi-device MPC) - not yet implemented
const { vault, vaultId, sessionId } = await sdk.createSecureVault({
  name: string
  password: string
  devices: number
  threshold?: number
  onProgress?: (step: VaultCreationStep) => void
})
```

### Supported Chains

```typescript
enum Chain {
  // EVM Chains
  Ethereum = 'Ethereum',
  Polygon = 'Polygon',
  BinanceSmartChain = 'BSC',
  Arbitrum = 'Arbitrum',
  Optimism = 'Optimism',
  Base = 'Base',
  Avalanche = 'Avalanche',
  Blast = 'Blast',
  CronosChain = 'CronosChain',
  ZkSync = 'ZkSync',

  // UTXO Chains
  Bitcoin = 'Bitcoin',
  BitcoinCash = 'BitcoinCash',
  Litecoin = 'Litecoin',
  Dogecoin = 'Dogecoin',
  Dash = 'Dash',

  // Cosmos Chains
  THORChain = 'THORChain',
  MayaChain = 'MayaChain',
  Cosmos = 'Cosmos',
  Osmosis = 'Osmosis',
  Dydx = 'Dydx',
  Kujira = 'Kujira',
  TerraClassic = 'TerraClassic',
  Terra = 'Terra',

  // Other Chains
  Solana = 'Solana',
  Polkadot = 'Polkadot',
  Sui = 'Sui',
  Ton = 'Ton',
  Ripple = 'Ripple',
  Tron = 'Tron',
  Cardano = 'Cardano'
}
```

### Common Configuration Options

```typescript
// Vultisig constructor options
new Vultisig({
  // Required
  storage: Storage,                // Storage implementation (MemoryStorage, custom, etc.)

  // Optional
  defaultChains: Chain[],          // Default chains for new vaults
  defaultCurrency: string,         // Default fiat currency ('USD', 'EUR', etc.)
  cacheConfig: {
    balanceTTL: number,            // Balance cache TTL in ms (default: 300000 = 5min)
    priceTTL: number,              // Price cache TTL in ms (default: 300000 = 5min)
    maxMemoryCacheSize: number     // Max cache entries (default: 1000)
  },
  passwordCache: {
    defaultTTL: number             // Password cache TTL in milliseconds
  },
  onPasswordRequired: (vaultId: string, vaultName: string) => Promise<string>,
  serverEndpoints: {
    fastVault: string,             // Custom VultiServer URL
    messageRelay: string           // Custom relay server URL
  }
})
```

---

## Platform Notes

### Browser

**WASM Files**: Must be served from the root path:

```bash
# Copy to public directory
cp node_modules/@vultisig/sdk/dist/*.wasm public/

# Ensure your dev server serves these files from /
# Vite: automatically serves from public/
# Create React App: automatically serves from public/
# Next.js: place in public/ directory
```

**IndexedDB Storage**: For persistent storage, use IndexedDB (see [examples/browser](../examples/browser) for implementation).

**Import**:

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

const sdk = new Vultisig()  // Uses BrowserStorage (IndexedDB) by default
await sdk.initialize()
```

**Security Considerations**:
- Use `type="password"` for password inputs
- Consider using Web Crypto API for sensitive data
- Implement Content Security Policy (CSP)

### Node.js

**Import**:

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

const sdk = new Vultisig()  // Uses FileStorage (~/.vultisig) by default
await sdk.initialize()
// ... use the SDK ...
sdk.dispose()
```

**Custom Storage**: For custom persistence needs, implement the `Storage` interface (see [Custom Storage Implementation](#custom-storage-implementation) for a full example).

**Password Input**: Use libraries like `inquirer` or `prompts` for CLI password input.

### React Native

**Status**: Coming soon

### Electron

**Status**: Coming soon

---

## Additional Resources

- **Examples**:
  - [Browser Example](../examples/browser) - Full React app with UI
  - [CLI](../clients/cli) - Command-line wallet with interactive shell mode

- **GitHub**: [vultisig-sdk](https://github.com/vultisig/vultisig-sdk)
- **Issues**: Report bugs and request features on GitHub

---

**Questions or feedback?** Open an issue on GitHub or check the example projects for more detailed implementations.
