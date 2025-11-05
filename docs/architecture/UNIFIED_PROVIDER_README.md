# Vultisig Unified Provider

A **framework-agnostic**, **environment-aware** provider layer for the Vultisig SDK that enables programmatic vault management across browser, Node.js, and Electron environments.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Environment Support](#environment-support)
- [Storage](#storage)
- [Events](#events)
- [Security Considerations](#security-considerations)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Unified Provider is a thin reactive state layer (~1800 LOC) that wraps the existing Vultisig SDK infrastructure to provide:

- ✅ **Persistent vault storage** across sessions
- ✅ **Event-driven state management** for reactive UIs
- ✅ **Automatic environment detection** (browser, Node.js, Electron)
- ✅ **Framework-agnostic** (works with vanilla JS, React, Vue, Svelte, etc.)
- ✅ **Type-safe TypeScript API**
- ✅ **Zero framework dependencies**

### What It Does

- Manages vault persistence (save/load across sessions)
- Emits events for state changes (connect, disconnect, balanceUpdated, etc.)
- Auto-detects runtime environment and uses appropriate storage
- Provides consistent API across all environments

### What It Does NOT Do

- ❌ Chain operations (delegated to existing Core)
- ❌ MPC protocols (delegated to existing Core)
- ❌ Transaction building (delegated to existing Core)
- ❌ Encryption (uses vault's built-in encryption)

---

## Features

### Environment Detection

```typescript
import { createProvider, detectEnvironment } from '@vultisig/sdk'

// Auto-detect and create appropriate provider
const provider = createProvider()

// Or check environment manually
const env = detectEnvironment()
console.log(env) // 'browser' | 'node' | 'electron-main' | 'electron-renderer'
```

### Storage Abstraction

| Environment | Primary Storage | Fallback | Quota |
|-------------|----------------|----------|-------|
| Browser | IndexedDB | localStorage → memory | ~50MB+ |
| Node.js | Filesystem | - | Disk space |
| Electron (main) | Filesystem (userData) | - | Disk space |
| Electron (renderer) | IndexedDB | localStorage → memory | ~50MB+ |

### Event System

```typescript
// Listen to vault events
provider.on('vaultChanged', ({ vaultId }) => {
  console.log('Vault changed:', vaultId)
})

provider.on('balanceUpdated', ({ chain, balance }) => {
  console.log(`${chain} balance:`, balance.amount)
})

provider.on('error', (error) => {
  console.error('Provider error:', error)
})
```

---

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
# or
pnpm add @vultisig/sdk
```

---

## Quick Start

### Browser

```typescript
import { createProvider } from '@vultisig/sdk'

// Create and connect
const provider = createProvider({ autoInit: true })
await provider.connect()

// Create a vault
const vault = await provider.createVault({
  name: 'My Wallet',
  type: 'fast',
  password: 'secure-password',
  email: 'user@example.com'
})

// Get balance
const balance = await provider.getBalance({ chain: 'Ethereum' })
console.log('ETH Balance:', balance.amount)

// Sign transaction
const signature = await provider.signTransaction({
  chain: 'Ethereum',
  payload: transactionPayload,
  password: 'secure-password',
  mode: 'fast'
})
```

### Node.js

```typescript
import { createNodeProvider } from '@vultisig/sdk'

// Create Node provider with custom storage path
const provider = createNodeProvider({
  storage: new NodeStorage({ basePath: '/custom/path' }),
  autoInit: true
})

await provider.connect()

// Import vault from file
const vault = await provider.importVaultFromFile(
  '/path/to/vault.vult',
  'password'
)

// Export vault to file
await provider.exportVaultToFile('/path/to/export.vult')
```

### Electron

#### Main Process

```typescript
import { ipcMain } from 'electron'
import { createElectronProvider } from '@vultisig/sdk'

const provider = createElectronProvider()

// Setup IPC handlers automatically
provider.setupIPCHandlers(ipcMain)

// Or manually
const handlers = provider.getIPCHandlers()
for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, handler)
}
```

#### Renderer Process

```typescript
import { ipcRenderer } from 'electron'

// Create vault via IPC
const vault = await ipcRenderer.invoke('vault:createVault', {
  name: 'My Vault',
  type: 'fast',
  password: 'secure-password',
  email: 'user@example.com'
})

// Get balance via IPC
const balance = await ipcRenderer.invoke('vault:getBalance', {
  chain: 'Ethereum'
})
```

---

## Core Concepts

### Connection Lifecycle

```typescript
// 1. Create provider
const provider = createProvider()

// 2. Connect (initializes WASM, loads last active vault)
await provider.connect()

// 3. Check connection status
if (provider.isConnected()) {
  const vault = provider.getActiveVault()
}

// 4. Disconnect (clears active vault)
await provider.disconnect()
```

### Vault Management

```typescript
// Create vault
const vault = await provider.createVault({
  name: 'My Wallet',
  type: 'fast', // 'fast' or 'secure'
  password: 'secure-password',
  email: 'user@example.com'
})

// List all vaults
const vaults = await provider.listVaults()

// Switch between vaults
await provider.switchVault(vaultId)

// Delete vault
await provider.deleteVault(vaultId)

// Get active vault
const activeVault = provider.getActiveVault()
```

### Transaction Signing

```typescript
// Sign transaction
const signature = await provider.signTransaction({
  chain: 'Ethereum',
  payload: {
    transaction: txData,
    chain: 'Ethereum'
  },
  password: 'secure-password',
  mode: 'fast' // 'fast' | 'relay' | 'local'
})

// Sign and broadcast
const txHash = await provider.sendTransaction({
  chain: 'Ethereum',
  payload: txPayload,
  password: 'secure-password',
  mode: 'fast'
})

// Sign message
const sig = await provider.signMessage({
  chain: 'Ethereum',
  message: 'Hello, Vultisig!',
  password: 'secure-password'
})

// Sign typed data (EIP-712)
const typedSig = await provider.signTypedData({
  chain: 'Ethereum',
  typedData: eip712Data,
  password: 'secure-password'
})
```

---

## API Reference

### VultisigProvider Interface

```typescript
interface VultisigProvider {
  // Connection
  connect(options?: ConnectionOptions): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Accounts
  getAccounts(chain?: string): Promise<string[]>
  getActiveAccount(chain: string): Promise<string | null>

  // Chains
  getSupportedChains(): string[]
  setActiveChain(chain: string): Promise<void>
  getActiveChain(): Promise<string>

  // Transactions
  signTransaction(params: SignTransactionParams): Promise<Signature>
  sendTransaction(params: SendTransactionParams): Promise<string>

  // Message Signing
  signMessage(params: SignMessageParams): Promise<string>
  signTypedData(params: SignTypedDataParams): Promise<string>

  // Balances
  getBalance(params: GetBalanceParams): Promise<Balance>
  getBalances(chains?: string[]): Promise<Record<string, Balance>>

  // Vaults
  createVault(options: CreateVaultOptions): Promise<Vault>
  importVault(file: File | Buffer, password?: string): Promise<Vault>
  listVaults(): Promise<VaultSummary[]>
  switchVault(vaultId: string): Promise<void>
  deleteVault(vaultId: string): Promise<void>
  getActiveVault(): Vault | null

  // Events
  on<K extends keyof ProviderEvents>(event: K, handler: EventHandler): () => void
  once<K extends keyof ProviderEvents>(event: K, handler: EventHandler): () => void
  off<K extends keyof ProviderEvents>(event: K, handler: EventHandler): void
}
```

### Factory Functions

```typescript
// Auto-detect environment
function createProvider(config?: ProviderConfig): VultisigProvider

// Explicit providers
function createBrowserProvider(config?: ProviderConfig): BrowserProvider
function createNodeProvider(config?: ProviderConfig): NodeProvider
function createElectronProvider(config?: ProviderConfig): ElectronProvider
```

### Configuration

```typescript
interface ProviderConfig {
  storage?: VaultStorage           // Custom storage implementation
  autoInit?: boolean               // Auto-initialize WASM
  autoConnect?: boolean            // Auto-connect on creation
  defaultChains?: string[]         // Default chains
  defaultCurrency?: string         // Default currency
  endpoints?: {
    fastVault?: string             // FastVault server URL
    relay?: string                 // Relay server URL
  }
}
```

---

## Environment Support

### Browser

- **Storage**: IndexedDB (primary) → localStorage (fallback) → memory
- **Features**: Blob export, download triggers
- **Security**: XSS vulnerable, use CSP headers

### Node.js

- **Storage**: Filesystem (`~/.vultisig`)
- **Features**: File I/O, atomic writes
- **Security**: File permissions (0600)

### Electron

- **Main Process**: Filesystem (userData directory), IPC handlers
- **Renderer Process**: IndexedDB, download triggers
- **Features**: IPC helpers, secure communication

### Web Workers

- **Storage**: In-memory only
- **Limitations**: No persistence

---

## Storage

### Custom Storage

Implement the `VaultStorage` interface:

```typescript
import { VaultStorage } from '@vultisig/sdk'

class CustomStorage implements VaultStorage {
  async get<T>(key: string): Promise<T | null> {
    // Your implementation
  }

  async set<T>(key: string, value: T): Promise<void> {
    // Your implementation
  }

  async remove(key: string): Promise<void> {
    // Your implementation
  }

  async list(): Promise<string[]> {
    // Your implementation
  }

  async clear(): Promise<void> {
    // Your implementation
  }
}

// Use custom storage
const provider = createProvider({
  storage: new CustomStorage()
})
```

### Storage Quota

```typescript
// Browser: Check quota
const { usage, quota, percentage } = await provider.getStorageInfo()
console.log(`Using ${percentage}% (${usage}/${quota} bytes)`)

// Node: Check usage
const { usage, path } = await provider.getStorageInfo()
console.log(`${usage} bytes in ${path}`)
```

---

## Events

### Available Events

```typescript
interface ProviderEvents {
  connect: void
  disconnect: void
  accountsChanged: { chain: string; accounts: string[] }
  chainChanged: { chain: string }
  vaultChanged: { vaultId: string }
  balanceUpdated: { chain: string; balance: Balance }
  error: Error
}
```

### Event Handling

```typescript
// Subscribe
const unsubscribe = provider.on('balanceUpdated', ({ chain, balance }) => {
  updateUI(chain, balance)
})

// One-time listener
provider.once('connect', () => {
  console.log('Connected!')
})

// Unsubscribe
unsubscribe() // or provider.off('balanceUpdated', handler)

// Remove all listeners
provider.removeAllListeners('balanceUpdated')
provider.removeAllListeners() // All events
```

---

## Security Considerations

### Data Storage

- **Browser**: Data stored in IndexedDB/localStorage is **not encrypted** by default
- **Node.js**: Files stored with 0600 permissions (owner only)
- **Recommendation**: Always use password-encrypted vaults

### XSS Protection

```html
<!-- Add Content Security Policy headers -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'">
```

### Electron Security

- Use preload scripts for IPC
- Don't expose `nodeIntegration` in renderer
- Validate all IPC messages

### Password Handling

```typescript
// DON'T store passwords
const vault = await provider.createVault({
  password: userPassword // Use immediately
})
// Clear password from memory
userPassword = null

// DO prompt for password each time
const signature = await provider.signTransaction({
  password: await promptUserForPassword()
})
```

---

## Examples

### React Integration

```typescript
import { createProvider } from '@vultisig/sdk'
import { useEffect, useState } from 'react'

function useVultisigProvider() {
  const [provider] = useState(() => createProvider({ autoInit: true }))
  const [balance, setBalance] = useState<Balance | null>(null)

  useEffect(() => {
    // Subscribe to events
    const unsubscribe = provider.on('balanceUpdated', ({ balance }) => {
      setBalance(balance)
    })

    // Connect
    provider.connect().catch(console.error)

    return () => {
      unsubscribe()
      provider.disconnect()
    }
  }, [provider])

  return { provider, balance }
}
```

### Vue Integration

```typescript
import { createProvider } from '@vultisig/sdk'
import { ref, onMounted, onUnmounted } from 'vue'

export function useVultisigProvider() {
  const provider = createProvider({ autoInit: true })
  const balance = ref<Balance | null>(null)

  onMounted(async () => {
    provider.on('balanceUpdated', ({ balance: b }) => {
      balance.value = b
    })

    await provider.connect()
  })

  onUnmounted(() => {
    provider.removeAllListeners()
    provider.disconnect()
  })

  return { provider, balance }
}
```

---

## Troubleshooting

### Storage Quota Exceeded

```typescript
// Clear old data
await provider.clearStorage?.()

// Use custom storage path
const provider = createNodeProvider({
  storage: new NodeStorage({ basePath: '/larger/disk' })
})
```

### WASM Initialization Failed

```typescript
// Manually initialize
const provider = createProvider({ autoInit: false })
try {
  await provider.connect() // Will initialize WASM
} catch (error) {
  console.error('Failed to initialize:', error)
}
```

### Vault Not Found

```typescript
// List available vaults
const vaults = await provider.listVaults()
console.log('Available vaults:', vaults)

// Import vault
await provider.importVault(file, password)
```

### IPC Communication Failed (Electron)

```typescript
// Main process: Ensure handlers are registered
provider.setupIPCHandlers(ipcMain)

// Renderer: Use contextBridge in preload
contextBridge.exposeInMainWorld('vultisig', {
  createVault: (options) => ipcRenderer.invoke('vault:createVault', options)
})
```

---

## Contributing

See [PROVIDER_IMPLEMENTATION_PLAN.md](./PROVIDER_IMPLEMENTATION_PLAN.md) for architecture details and contribution guidelines.

---

## License

MIT License - see LICENSE file for details
