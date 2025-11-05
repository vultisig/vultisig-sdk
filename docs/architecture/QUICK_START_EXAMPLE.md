# Quick Start Example

## Browser Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Vultisig Provider Example</title>
</head>
<body>
  <h1>Vultisig Wallet</h1>

  <div id="app">
    <button id="create-vault">Create Vault</button>
    <button id="get-balance">Get ETH Balance</button>
    <div id="status"></div>
  </div>

  <script type="module">
    import { createProvider } from '@vultisig/sdk'

    // Create provider (auto-detects browser environment)
    const provider = createProvider({ autoInit: true })

    // Setup event listeners
    provider.on('connect', () => {
      updateStatus('Connected!')
    })

    provider.on('vaultChanged', ({ vaultId }) => {
      updateStatus(`Vault changed: ${vaultId}`)
    })

    provider.on('balanceUpdated', ({ chain, balance }) => {
      updateStatus(`${chain}: ${balance.amount} ${balance.symbol}`)
    })

    provider.on('error', (error) => {
      updateStatus(`Error: ${error.message}`, 'error')
    })

    // Connect
    await provider.connect()

    // Create vault button
    document.getElementById('create-vault').addEventListener('click', async () => {
      try {
        const vault = await provider.createVault({
          name: 'My Wallet',
          type: 'fast',
          password: 'secure-password-123',
          email: 'user@example.com'
        })

        updateStatus(`Vault created: ${vault.data.name}`)
      } catch (error) {
        updateStatus(`Failed to create vault: ${error.message}`, 'error')
      }
    })

    // Get balance button
    document.getElementById('get-balance').addEventListener('click', async () => {
      try {
        const balance = await provider.getBalance({ chain: 'Ethereum' })
        updateStatus(`ETH Balance: ${balance.amount} ${balance.symbol}`)
      } catch (error) {
        updateStatus(`Failed to get balance: ${error.message}`, 'error')
      }
    })

    function updateStatus(message, type = 'info') {
      const statusEl = document.getElementById('status')
      statusEl.textContent = message
      statusEl.className = type
    }
  </script>

  <style>
    #status { margin-top: 20px; padding: 10px; border-radius: 4px; }
    #status.info { background: #e3f2fd; color: #1976d2; }
    #status.error { background: #ffebee; color: #c62828; }
  </style>
</body>
</html>
```

## Node.js Example

```typescript
import { createNodeProvider } from '@vultisig/sdk'

async function main() {
  // Create Node.js provider
  const provider = createNodeProvider({
    autoInit: true,
    defaultChains: ['Ethereum', 'Bitcoin']
  })

  // Setup event listeners
  provider.on('connect', () => {
    console.log('✅ Connected to Vultisig')
  })

  provider.on('vaultChanged', ({ vaultId }) => {
    console.log(`🔐 Active vault: ${vaultId}`)
  })

  provider.on('error', (error) => {
    console.error('❌ Error:', error.message)
  })

  // Connect
  await provider.connect()

  // List existing vaults
  const vaults = await provider.listVaults()
  console.log(`Found ${vaults.length} vaults`)

  if (vaults.length === 0) {
    // Create first vault
    console.log('Creating new vault...')
    const vault = await provider.createVault({
      name: 'My CLI Wallet',
      type: 'fast',
      password: process.env.VAULT_PASSWORD || 'secure-password',
      email: process.env.USER_EMAIL || 'user@example.com'
    })

    console.log(`✅ Vault created: ${vault.data.name}`)
  } else {
    // Use existing vault
    await provider.switchVault(vaults[0].id)
    console.log(`✅ Loaded vault: ${vaults[0].name}`)
  }

  // Get balances
  console.log('\nFetching balances...')
  const balances = await provider.getBalances(['Ethereum', 'Bitcoin'])

  for (const [chain, balance] of Object.entries(balances)) {
    console.log(`${chain}: ${balance.amount} ${balance.symbol}`)
  }

  // Export vault
  const exportPath = './my-vault-backup.vult'
  await provider.exportVaultToFile(exportPath)
  console.log(`\n💾 Vault exported to: ${exportPath}`)

  // Disconnect
  await provider.disconnect()
  console.log('\n👋 Disconnected')
}

main().catch(console.error)
```

## Electron Example

### Main Process (main.ts)

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import { createElectronProvider } from '@vultisig/sdk'

let mainWindow: BrowserWindow
let provider: ElectronProvider

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')
}

app.whenReady().then(async () => {
  // Create Electron provider (main process)
  provider = createElectronProvider({ autoInit: true })

  // Setup IPC handlers automatically
  provider.setupIPCHandlers(ipcMain)

  // Setup event forwarding to renderer
  provider.on('vaultChanged', ({ vaultId }) => {
    mainWindow.webContents.send('vault-changed', vaultId)
  })

  provider.on('balanceUpdated', ({ chain, balance }) => {
    mainWindow.webContents.send('balance-updated', { chain, balance })
  })

  // Connect
  await provider.connect()

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

### Preload Script (preload.ts)

```typescript
import { contextBridge, ipcRenderer } from 'electron'

// Expose safe IPC methods to renderer
contextBridge.exposeInMainWorld('vultisig', {
  // Vault operations
  createVault: (options: any) =>
    ipcRenderer.invoke('vault:createVault', options),

  listVaults: () =>
    ipcRenderer.invoke('vault:listVaults'),

  switchVault: (vaultId: string) =>
    ipcRenderer.invoke('vault:switchVault', vaultId),

  // Balance operations
  getBalance: (params: any) =>
    ipcRenderer.invoke('vault:getBalance', params),

  getBalances: (chains?: string[]) =>
    ipcRenderer.invoke('vault:getBalances', chains),

  // Transaction operations
  signTransaction: (params: any) =>
    ipcRenderer.invoke('vault:signTransaction', params),

  // Event listeners
  onVaultChanged: (callback: (vaultId: string) => void) => {
    ipcRenderer.on('vault-changed', (_event, vaultId) => callback(vaultId))
  },

  onBalanceUpdated: (callback: (data: any) => void) => {
    ipcRenderer.on('balance-updated', (_event, data) => callback(data))
  }
})
```

### Renderer (renderer.ts)

```typescript
// Access via preload bridge
const { vultisig } = window as any

// Create vault
document.getElementById('create-vault')?.addEventListener('click', async () => {
  try {
    const vault = await vultisig.createVault({
      name: 'My Electron Wallet',
      type: 'fast',
      password: 'secure-password',
      email: 'user@example.com'
    })

    console.log('Vault created:', vault)
  } catch (error) {
    console.error('Failed to create vault:', error)
  }
})

// Listen to events
vultisig.onVaultChanged((vaultId: string) => {
  console.log('Vault changed:', vaultId)
  updateUI()
})

vultisig.onBalanceUpdated((data: any) => {
  console.log('Balance updated:', data)
  updateBalanceUI(data.chain, data.balance)
})

// Get balances
async function loadBalances() {
  const balances = await vultisig.getBalances(['Ethereum', 'Bitcoin'])
  for (const [chain, balance] of Object.entries(balances)) {
    updateBalanceUI(chain, balance)
  }
}
```

## React Hook Example

```typescript
import { createProvider, VultisigProvider, Balance } from '@vultisig/sdk'
import { useEffect, useState } from 'react'

export function useVultisigProvider() {
  const [provider] = useState<VultisigProvider>(() =>
    createProvider({ autoInit: true })
  )
  const [connected, setConnected] = useState(false)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Setup event listeners
    const unsubscribers = [
      provider.on('connect', () => setConnected(true)),
      provider.on('disconnect', () => setConnected(false)),
      provider.on('balanceUpdated', ({ balance }) => setBalance(balance)),
      provider.on('error', (err) => setError(err.message))
    ]

    // Connect
    provider.connect().catch(err => setError(err.message))

    // Cleanup
    return () => {
      unsubscribers.forEach(unsub => unsub())
      provider.disconnect()
    }
  }, [provider])

  return {
    provider,
    connected,
    balance,
    error
  }
}

// Usage in component
function WalletComponent() {
  const { provider, connected, balance, error } = useVultisigProvider()

  if (!connected) return <div>Connecting...</div>
  if (error) return <div>Error: {error}</div>

  return (
    <div>
      <h2>Wallet</h2>
      {balance && (
        <p>Balance: {balance.amount} {balance.symbol}</p>
      )}
      <button onClick={async () => {
        await provider.getBalance({ chain: 'Ethereum' })
      }}>
        Refresh Balance
      </button>
    </div>
  )
}
```

## Vue Composable Example

```typescript
import { createProvider, VultisigProvider, Balance } from '@vultisig/sdk'
import { ref, onMounted, onUnmounted, Ref } from 'vue'

export function useVultisigProvider() {
  const provider = createProvider({ autoInit: true })
  const connected = ref(false)
  const balance: Ref<Balance | null> = ref(null)
  const error: Ref<string | null> = ref(null)

  onMounted(async () => {
    // Setup event listeners
    provider.on('connect', () => {
      connected.value = true
    })

    provider.on('disconnect', () => {
      connected.value = false
    })

    provider.on('balanceUpdated', ({ balance: b }) => {
      balance.value = b
    })

    provider.on('error', (err) => {
      error.value = err.message
    })

    // Connect
    try {
      await provider.connect()
    } catch (err) {
      error.value = (err as Error).message
    }
  })

  onUnmounted(() => {
    provider.removeAllListeners()
    provider.disconnect()
  })

  return {
    provider,
    connected,
    balance,
    error
  }
}

// Usage in component
export default {
  setup() {
    const { provider, connected, balance, error } = useVultisigProvider()

    const refreshBalance = async () => {
      await provider.getBalance({ chain: 'Ethereum' })
    }

    return {
      connected,
      balance,
      error,
      refreshBalance
    }
  }
}
```

## Testing Example

```typescript
import { createProvider, MemoryStorage } from '@vultisig/sdk'
import { describe, it, expect, beforeEach } from 'vitest'

describe('VultisigProvider', () => {
  let provider: VultisigProvider

  beforeEach(() => {
    // Use memory storage for tests
    provider = createProvider({
      storage: new MemoryStorage(),
      autoInit: true
    })
  })

  it('should connect successfully', async () => {
    await provider.connect()
    expect(provider.isConnected()).toBe(true)
  })

  it('should create and list vaults', async () => {
    await provider.connect()

    await provider.createVault({
      name: 'Test Vault',
      type: 'fast',
      password: 'test-password',
      email: 'test@example.com'
    })

    const vaults = await provider.listVaults()
    expect(vaults).toHaveLength(1)
    expect(vaults[0].name).toBe('Test Vault')
  })

  it('should emit events', async () => {
    const events: string[] = []

    provider.on('connect', () => events.push('connect'))
    provider.on('vaultChanged', () => events.push('vaultChanged'))

    await provider.connect()
    await provider.createVault({
      name: 'Test',
      type: 'fast',
      password: 'pass',
      email: 'test@test.com'
    })

    expect(events).toContain('connect')
    expect(events).toContain('vaultChanged')
  })
})
```
