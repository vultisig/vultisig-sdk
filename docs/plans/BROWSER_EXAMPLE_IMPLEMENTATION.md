# Browser Example Implementation Guide

## Overview

This document provides a comprehensive implementation plan for creating a browser-based example application (`examples/browser/`) that demonstrates all features of the Vultisig SDK for fast vaults, similar to the existing shell example but with a modern web UI.

### Goals

1. **Simple & Elegant**: Use React + Vite + Tailwind CSS for a clean, widely-understood implementation
2. **Full-Featured**: Support all SDK fast vault features (creation, signing, transactions)
3. **Multi-Vault Support**: Tab-based interface for managing multiple vaults simultaneously
4. **Event Transparency**: Real-time event log showing all SDK events from all vaults
5. **Developer Reference**: Serve as the primary example for browser SDK integration

### Target Audience

Developers who want to:
- Integrate Vultisig SDK into web applications
- Understand browser-specific SDK setup and configuration
- See practical examples of vault management and transactions in the browser

---

## Prerequisites

### Knowledge Requirements
- Intermediate React and TypeScript experience
- Understanding of async/await patterns
- Basic knowledge of Web Crypto API and IndexedDB (helpful but not required)
- Familiarity with Vite build tool

### Development Environment
- Node.js 18+ and Yarn
- Modern browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Code editor with TypeScript support (VS Code recommended)

---

## Project Structure

```
examples/browser/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .gitignore
├── README.md
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx                    # Entry point
    ├── App.tsx                     # Root component
    ├── styles.css                  # Global styles
    ├── types.ts                    # Shared type definitions
    ├── components/
    │   ├── layout/
    │   │   ├── Header.tsx          # App header with title
    │   │   ├── Sidebar.tsx         # Left sidebar navigation
    │   │   └── Layout.tsx          # Main layout wrapper
    │   ├── vault/
    │   │   ├── VaultCreator.tsx    # Create new fast vault
    │   │   ├── VaultImporter.tsx   # Import .vult file(s)
    │   │   ├── VaultExporter.tsx   # Export vault to file
    │   │   ├── VaultTabs.tsx       # Tab interface for multiple vaults
    │   │   ├── VaultInfo.tsx       # Display vault details
    │   │   └── VaultLocker.tsx     # Lock/unlock vault
    │   ├── wallet/
    │   │   ├── AddressDisplay.tsx  # Show addresses by chain
    │   │   ├── BalanceDisplay.tsx  # Balance table
    │   │   ├── PortfolioValue.tsx  # Total portfolio value
    │   │   ├── ChainManager.tsx    # Add/remove chains
    │   │   └── TokenManager.tsx    # Add/remove tokens
    │   ├── transaction/
    │   │   ├── TransactionForm.tsx # Send transaction form
    │   │   ├── TransactionPreview.tsx # Confirm before send
    │   │   └── SigningProgress.tsx # Progress indicator
    │   ├── events/
    │   │   ├── EventLog.tsx        # Real-time event display
    │   │   └── EventFilter.tsx     # Filter events by type
    │   └── common/
    │       ├── Button.tsx          # Reusable button
    │       ├── Input.tsx           # Form input
    │       ├── Select.tsx          # Dropdown select
    │       ├── Spinner.tsx         # Loading spinner
    │       ├── Toast.tsx           # Toast notifications
    │       └── Modal.tsx           # Modal dialog
    ├── hooks/
    │   ├── useVault.ts             # Current vault state
    │   ├── useBalances.ts          # Balance fetching
    │   ├── useEvents.ts            # Event subscription
    │   └── useToast.ts             # Toast notifications
    ├── utils/
    │   ├── sdk.ts                  # SDK initialization
    │   ├── events.ts               # Event helpers
    │   ├── formatting.ts           # Display formatters
    │   ├── validation.ts           # Form validation
    │   └── storage.ts              # LocalStorage helpers
    └── constants/
        ├── chains.ts               # Chain configurations
        └── config.ts               # App configuration
```

---

## Phase 1: Project Setup

### Step 1.1: Create Package Configuration

Create `examples/browser/package.json`:

```json
{
  "name": "@vultisig/example-browser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vultisig/sdk": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "isomorphic-fetch": "^3.0.0",
    "process": "^0.11.10"
  },
  "devDependencies": {
    "@types/node": "^20.12.7",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "buffer": "^6.0.3",
    "crypto-browserify": "^3.12.0",
    "events": "^3.3.0",
    "path-browserify": "^1.0.1",
    "postcss": "^8.4.47",
    "stream-browserify": "^3.0.0",
    "tailwindcss": "^3.4.15",
    "typescript": "^5.8.2",
    "vite": "^6.2.2",
    "vite-plugin-node-polyfills": "^0.24.0",
    "vite-plugin-wasm": "^3.4.1"
  }
}
```

### Step 1.2: Configure Vite

Create `examples/browser/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    wasm(), // Required for WASM loading
    nodePolyfills({
      exclude: ['fs'], // fs not available in browser
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Polyfills for Node.js modules
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      path: 'path-browserify',
      events: 'events',
      'node-fetch': 'isomorphic-fetch',
    },
  },
  optimizeDeps: {
    include: [
      'buffer',
      'process',
      'crypto-browserify',
      'stream-browserify',
      'events',
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          sdk: ['@vultisig/sdk'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
```

### Step 1.3: TypeScript Configuration

Create `examples/browser/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `examples/browser/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### Step 1.4: HTML Entry Point

Create `examples/browser/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vultisig Browser Example</title>
    <meta name="description" content="Browser example for Vultisig SDK demonstrating fast vault features" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Step 1.5: Git Ignore

Create `examples/browser/.gitignore`:

```
# Dependencies
node_modules
.yarn

# Build outputs
dist
dist-ssr
*.local

# Editor
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment
.env
.env.local
.env.*.local

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
```

### Step 1.6: Configure Tailwind CSS

Create `examples/browser/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
      },
    },
  },
  plugins: [],
}
```

Create `examples/browser/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

Update `src/styles.css` to include Tailwind directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom base styles */
@layer base {
  body {
    @apply antialiased;
  }
}

/* Custom component styles */
@layer components {
  .btn {
    @apply px-4 py-2 rounded-lg font-medium transition-all duration-200;
  }

  .btn-primary {
    @apply bg-primary text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed;
  }

  .btn-secondary {
    @apply bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed;
  }
}
```

### Step 1.7: Install Dependencies

```bash
cd examples/browser
yarn install
```

---

## Phase 2: Foundation & SDK Setup

### Step 2.1: SDK Initialization Utility

Create `src/utils/sdk.ts`:

```typescript
import { GlobalConfig, Vultisig } from '@vultisig/sdk'

let sdkInstance: Vultisig | null = null

/**
 * Password cache TTL in milliseconds (5 minutes)
 */
const PASSWORD_CACHE_TTL = 5 * 60 * 1000

/**
 * Initialize the Vultisig SDK with browser-specific configuration
 */
export async function initializeSDK(): Promise<Vultisig> {
  if (sdkInstance) {
    return sdkInstance
  }

  // Configure global settings before SDK initialization
  GlobalConfig.configure({
    passwordCache: {
      defaultTTL: PASSWORD_CACHE_TTL,
      registerExitHandlers: false, // Not needed in browser
    },
    onPasswordRequired: async (vaultId: string, vaultName?: string) => {
      // This will be called when a vault needs to be unlocked
      // In a real app, show a modal dialog to collect the password
      const displayName = vaultName || vaultId.slice(0, 8)
      const password = window.prompt(
        `Please enter the password for vault: ${displayName}`
      )

      if (!password) {
        throw new Error('Password required')
      }

      return password
    },
  })

  // Initialize SDK
  sdkInstance = new Vultisig()
  await sdkInstance.initialize()

  return sdkInstance
}

/**
 * Get the initialized SDK instance
 * @throws Error if SDK is not initialized
 */
export function getSDK(): Vultisig {
  if (!sdkInstance) {
    throw new Error('SDK not initialized. Call initializeSDK() first.')
  }
  return sdkInstance
}
```

### Step 2.2: Event Types and Utilities

Create `src/types.ts`:

```typescript
import type { Chain, Vault, Balance, Token } from '@vultisig/sdk'

export interface EventLogEntry {
  id: string
  timestamp: Date
  type: EventType
  source: 'sdk' | 'vault'
  message: string
  data?: any
}

export type EventType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'balance'
  | 'transaction'
  | 'signing'
  | 'vault'
  | 'chain'

export interface AppState {
  sdk: any | null
  openVaults: Map<string, Vault>  // Map of vaultId -> Vault instance
  activeVaultId: string | null     // Currently active tab
  vaultMetadata: VaultListItem[]   // All available vaults
  events: EventLogEntry[]
  isLoading: boolean
  error: string | null
}

export interface VaultListItem {
  id: string
  name: string
  isEncrypted: boolean
  chainCount: number
  lastAccessed?: Date              // For sorting tabs
}

export interface TransactionFormData {
  chain: Chain
  recipient: string
  amount: string
  tokenId?: string
  memo?: string
}
```

Create `src/utils/events.ts`:

```typescript
import type { EventLogEntry, EventType } from '@/types'

let eventIdCounter = 0

/**
 * Create a new event log entry
 */
export function createEvent(
  type: EventType,
  source: 'sdk' | 'vault',
  message: string,
  data?: any
): EventLogEntry {
  return {
    id: `event-${++eventIdCounter}-${Date.now()}`,
    timestamp: new Date(),
    type,
    source,
    message,
    data,
  }
}

/**
 * Format event timestamp for display
 */
export function formatEventTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * Get color for event type
 */
export function getEventColor(type: EventType): string {
  const colors: Record<EventType, string> = {
    info: '#3b82f6',      // blue
    success: '#10b981',   // green
    warning: '#f59e0b',   // amber
    error: '#ef4444',     // red
    balance: '#8b5cf6',   // violet
    transaction: '#06b6d4', // cyan
    signing: '#ec4899',   // pink
    vault: '#6366f1',     // indigo
    chain: '#14b8a6',     // teal
  }
  return colors[type]
}
```

### Step 2.3: Formatting Utilities

Create `src/utils/formatting.ts`:

```typescript
import type { Chain } from '@vultisig/sdk'

/**
 * Shorten an address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return ''
  if (address.length <= chars * 2 + 2) return address
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Format a balance amount with decimals
 */
export function formatBalance(
  amount: string | bigint,
  decimals: number,
  maxDecimals = 6
): string {
  try {
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount
    const divisor = BigInt(10 ** decimals)
    const integerPart = amountBigInt / divisor
    const fractionalPart = amountBigInt % divisor

    if (fractionalPart === 0n) {
      return integerPart.toString()
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
    const trimmed = fractionalStr.slice(0, maxDecimals).replace(/0+$/, '')

    return trimmed ? `${integerPart}.${trimmed}` : integerPart.toString()
  } catch (error) {
    return '0'
  }
}

/**
 * Format a fiat value (USD, EUR, etc.)
 */
export function formatFiatValue(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Parse amount string to BigInt with decimals
 */
export function parseAmount(amount: string, decimals: number): bigint {
  if (!amount || amount === '0') return 0n

  const [integerPart, fractionalPart = ''] = amount.split('.')
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals)
  const combined = integerPart + paddedFractional

  return BigInt(combined)
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerUrl(chain: Chain, txHash: string): string {
  const explorers: Record<string, string> = {
    Ethereum: `https://etherscan.io/tx/${txHash}`,
    Bitcoin: `https://blockstream.info/tx/${txHash}`,
    Avalanche: `https://snowtrace.io/tx/${txHash}`,
    BSC: `https://bscscan.com/tx/${txHash}`,
    Polygon: `https://polygonscan.com/tx/${txHash}`,
    // Add more chains as needed
  }

  return explorers[chain] || '#'
}

/**
 * Validate Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate Bitcoin address
 */
export function isValidBitcoinAddress(address: string): boolean {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/.test(address)
}
```

### Step 2.4: Storage Utilities

Create `src/utils/storage.ts`:

```typescript
import type { VaultListItem } from '@/types'

const VAULT_LIST_KEY = 'vultisig_vault_list'
const SETTINGS_KEY = 'vultisig_settings'

/**
 * Load vault list from localStorage
 */
export function loadVaultList(): VaultListItem[] {
  try {
    const data = localStorage.getItem(VAULT_LIST_KEY)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Failed to load vault list:', error)
    return []
  }
}

/**
 * Save vault list to localStorage
 */
export function saveVaultList(vaults: VaultListItem[]): void {
  try {
    localStorage.setItem(VAULT_LIST_KEY, JSON.stringify(vaults))
  } catch (error) {
    console.error('Failed to save vault list:', error)
  }
}

/**
 * Add vault to list
 */
export function addVaultToList(vault: VaultListItem): void {
  const vaults = loadVaultList()
  const existing = vaults.find(v => v.id === vault.id)

  if (!existing) {
    vaults.push(vault)
    saveVaultList(vaults)
  }
}

/**
 * Remove vault from list
 */
export function removeVaultFromList(vaultId: string): void {
  const vaults = loadVaultList()
  const filtered = vaults.filter(v => v.id !== vaultId)
  saveVaultList(filtered)
}

/**
 * Update vault in list
 */
export function updateVaultInList(vaultId: string, updates: Partial<VaultListItem>): void {
  const vaults = loadVaultList()
  const index = vaults.findIndex(v => v.id === vaultId)

  if (index !== -1) {
    vaults[index] = { ...vaults[index], ...updates }
    saveVaultList(vaults)
  }
}

/**
 * App settings interface
 */
export interface AppSettings {
  theme: 'light' | 'dark'
  defaultCurrency: string
  autoLockTimeout: number
  showTestnets: boolean
}

const defaultSettings: AppSettings = {
  theme: 'light',
  defaultCurrency: 'USD',
  autoLockTimeout: 300000, // 5 minutes
  showTestnets: false,
}

/**
 * Load app settings
 */
export function loadSettings(): AppSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY)
    return data ? { ...defaultSettings, ...JSON.parse(data) } : defaultSettings
  } catch (error) {
    console.error('Failed to load settings:', error)
    return defaultSettings
  }
}

/**
 * Save app settings
 */
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}
```

### Step 2.5: Constants

Create `src/constants/config.ts`:

```typescript
export const APP_NAME = 'Vultisig Browser Example'
export const APP_VERSION = '0.1.0'

export const PASSWORD_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export const SUPPORTED_FIAT_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
] as const

export const EVENT_LOG_MAX_ENTRIES = 1000

export const AUTO_REFRESH_INTERVAL = 30000 // 30 seconds
```

Create `src/constants/chains.ts`:

```typescript
import type { Chain } from '@vultisig/sdk'

/**
 * Commonly used chains for quick access
 */
export const POPULAR_CHAINS: Chain[] = [
  'Ethereum',
  'Bitcoin',
  'Avalanche',
  'BSC',
  'Polygon',
  'Arbitrum',
  'Optimism',
  'Base',
]

/**
 * All supported chains
 */
export const ALL_CHAINS: Chain[] = [
  'Ethereum',
  'Bitcoin',
  'Avalanche',
  'BSC',
  'Polygon',
  'Arbitrum',
  'Optimism',
  'Base',
  'Solana',
  'THORChain',
  'Maya',
  'Cosmos',
  'Kujira',
  'Dydx',
  'Polkadot',
  'Sui',
  // Add more as SDK supports them
]

/**
 * Get chain display name
 */
export function getChainDisplayName(chain: Chain): string {
  return chain
}

/**
 * Get chain color for UI
 */
export function getChainColor(chain: Chain): string {
  const colors: Record<string, string> = {
    Ethereum: '#627EEA',
    Bitcoin: '#F7931A',
    Avalanche: '#E84142',
    BSC: '#F3BA2F',
    Polygon: '#8247E5',
    Arbitrum: '#28A0F0',
    Optimism: '#FF0420',
    Base: '#0052FF',
    Solana: '#14F195',
    THORChain: '#00CCFF',
  }
  return colors[chain] || '#6B7280'
}
```

---

## Phase 3: React App Structure

### Step 3.1: Main Entry Point

Create `src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initializeSDK } from '@/utils/sdk'

// Initialize SDK before rendering
async function bootstrap() {
  try {
    await initializeSDK()

    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  } catch (error) {
    console.error('Failed to initialize SDK:', error)
    document.getElementById('root')!.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Initialization Error</h1>
        <p>Failed to initialize Vultisig SDK: ${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    `
  }
}

bootstrap()
```

### Step 3.2: Root App Component

Create `src/App.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { getSDK } from '@/utils/sdk'
import type { Vault } from '@vultisig/sdk'
import type { AppState, EventLogEntry, VaultListItem } from '@/types'
import { createEvent } from '@/utils/events'
import { loadVaultList, saveVaultList } from '@/utils/storage'

// Components (to be created)
import Layout from '@/components/layout/Layout'
import VaultCreator from '@/components/vault/VaultCreator'
import VaultImporter from '@/components/vault/VaultImporter'
import VaultTabs from '@/components/vault/VaultTabs'
import VaultInfo from '@/components/vault/VaultInfo'
import BalanceDisplay from '@/components/wallet/BalanceDisplay'
import TransactionForm from '@/components/transaction/TransactionForm'
import EventLog from '@/components/events/EventLog'
import { Toast, useToast } from '@/components/common/Toast'

function App() {
  const [appState, setAppState] = useState<AppState>({
    sdk: null,
    openVaults: new Map(),
    activeVaultId: null,
    vaultMetadata: [],
    events: [],
    isLoading: true,
    error: null,
  })

  const { toast, showToast } = useToast()

  // Initialize app
  useEffect(() => {
    const init = async () => {
      try {
        const sdk = getSDK()
        const vaultList = loadVaultList()

        setAppState(prev => ({
          ...prev,
          sdk,
          vaultMetadata: vaultList,
          isLoading: false,
        }))

        addEvent('success', 'sdk', 'SDK initialized successfully')
      } catch (error) {
        setAppState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
        addEvent('error', 'sdk', `Failed to initialize: ${error}`)
      }
    }

    init()
  }, [])

  // Subscribe to SDK events
  useEffect(() => {
    if (!appState.sdk) return

    const sdk = appState.sdk

    const handleVaultChanged = ({ vaultId }: { vaultId: string }) => {
      addEvent('info', 'sdk', `Vault changed: ${vaultId}`)
    }

    const handleError = (error: Error) => {
      addEvent('error', 'sdk', `SDK error: ${error.message}`)
      showToast(error.message, 'error')
    }

    sdk.on('vaultChanged', handleVaultChanged)
    sdk.on('error', handleError)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
      sdk.off('error', handleError)
    }
  }, [appState.sdk])

  // Subscribe to all open vault events
  useEffect(() => {
    const cleanupFunctions: (() => void)[] = []

    appState.openVaults.forEach((vault, vaultId) => {
      // Create handlers with vault context
      const vaultPrefix = `[${vault.name}]`

      const handleBalanceUpdated = ({ chain, balance }: any) => {
        addEvent('balance', 'vault', `${vaultPrefix} Balance updated for ${chain}`)
      }

      const handleTransactionSigned = ({ signature }: any) => {
        addEvent('success', 'vault', `${vaultPrefix} Transaction signed successfully`)
        if (vaultId === appState.activeVaultId) {
          showToast('Transaction signed!', 'success')
        }
      }

      const handleTransactionBroadcast = ({ chain, txHash }: any) => {
        addEvent('transaction', 'vault', `${vaultPrefix} Transaction broadcast on ${chain}: ${txHash}`)
        if (vaultId === appState.activeVaultId) {
          showToast('Transaction broadcast!', 'success')
        }
      }

      const handleSigningProgress = ({ step }: any) => {
        addEvent('signing', 'vault', `${vaultPrefix} ${step.message} (${step.progress}%)`)
      }

      const handleChainAdded = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain added: ${chain}`)
        if (vaultId === appState.activeVaultId) {
          showToast(`Added ${chain}`, 'success')
        }
      }

      const handleChainRemoved = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain removed: ${chain}`)
      }

      const handleVaultError = (error: Error) => {
        addEvent('error', 'vault', `${vaultPrefix} Vault error: ${error.message}`)
        if (vaultId === appState.activeVaultId) {
          showToast(error.message, 'error')
        }
      }

      // Subscribe to events
      vault.on('balanceUpdated', handleBalanceUpdated)
      vault.on('transactionSigned', handleTransactionSigned)
      vault.on('transactionBroadcast', handleTransactionBroadcast)
      vault.on('signingProgress', handleSigningProgress)
      vault.on('chainAdded', handleChainAdded)
      vault.on('chainRemoved', handleChainRemoved)
      vault.on('error', handleVaultError)

      // Store cleanup function
      cleanupFunctions.push(() => {
        vault.off('balanceUpdated', handleBalanceUpdated)
        vault.off('transactionSigned', handleTransactionSigned)
        vault.off('transactionBroadcast', handleTransactionBroadcast)
        vault.off('signingProgress', handleSigningProgress)
        vault.off('chainAdded', handleChainAdded)
        vault.off('chainRemoved', handleChainRemoved)
        vault.off('error', handleVaultError)
      })
    })

    // Cleanup all subscriptions
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup())
    }
  }, [appState.openVaults, appState.activeVaultId])

  const addEvent = (
    type: EventLogEntry['type'],
    source: EventLogEntry['source'],
    message: string,
    data?: any
  ) => {
    setAppState(prev => ({
      ...prev,
      events: [...prev.events, createEvent(type, source, message, data)].slice(-1000), // Keep last 1000
    }))
  }

  const handleVaultCreated = (vault: Vault) => {
    const vaultItem: VaultListItem = {
      id: vault.id,
      name: vault.name,
      isEncrypted: vault.isEncrypted,
      chainCount: vault.chains.length,
      lastAccessed: new Date(),
    }

    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.set(vault.id, vault)

      const newMetadata = [...prev.vaultMetadata, vaultItem]
      saveVaultList(newMetadata)

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: vault.id,
        vaultMetadata: newMetadata,
      }
    })

    addEvent('vault', 'sdk', `Vault created: ${vault.name}`)
    showToast(`Vault "${vault.name}" created!`, 'success')
  }

  const handleVaultImported = (vaults: Vault[]) => {
    const newMetadata: VaultListItem[] = vaults.map(vault => ({
      id: vault.id,
      name: vault.name,
      isEncrypted: vault.isEncrypted,
      chainCount: vault.chains.length,
      lastAccessed: new Date(),
    }))

    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      vaults.forEach(vault => newOpenVaults.set(vault.id, vault))

      const updatedMetadata = [...prev.vaultMetadata, ...newMetadata]
      saveVaultList(updatedMetadata)

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: vaults[0]?.id || prev.activeVaultId,
        vaultMetadata: updatedMetadata,
      }
    })

    addEvent('vault', 'sdk', `Imported ${vaults.length} vault(s)`)
    showToast(`Imported ${vaults.length} vault(s)!`, 'success')
  }

  const handleTabOpen = async (vaultId: string) => {
    // Check if vault is already open
    if (appState.openVaults.has(vaultId)) {
      setAppState(prev => ({ ...prev, activeVaultId: vaultId }))
      return
    }

    // Load vault from SDK
    try {
      const vault = await appState.sdk.getVault(vaultId)

      setAppState(prev => {
        const newOpenVaults = new Map(prev.openVaults)
        newOpenVaults.set(vaultId, vault)

        return {
          ...prev,
          openVaults: newOpenVaults,
          activeVaultId: vaultId,
        }
      })

      addEvent('info', 'sdk', `Vault opened: ${vault.name}`)
    } catch (error) {
      addEvent('error', 'sdk', `Failed to load vault: ${error}`)
      showToast('Failed to load vault', 'error')
    }
  }

  const handleTabClose = (vaultId: string) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.delete(vaultId)

      // If closing active tab, switch to another one
      let newActiveId = prev.activeVaultId
      if (vaultId === prev.activeVaultId) {
        const remainingIds = Array.from(newOpenVaults.keys())
        newActiveId = remainingIds[remainingIds.length - 1] || null
      }

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: newActiveId,
      }
    })

    const vault = appState.openVaults.get(vaultId)
    if (vault) {
      addEvent('info', 'sdk', `Vault closed: ${vault.name}`)
    }
  }

  const handleTabSwitch = (vaultId: string) => {
    setAppState(prev => ({ ...prev, activeVaultId: vaultId }))

    const vault = appState.openVaults.get(vaultId)
    if (vault) {
      addEvent('info', 'sdk', `Switched to vault: ${vault.name}`)
    }
  }

  const handleClearEvents = () => {
    setAppState(prev => ({ ...prev, events: [] }))
  }

  if (appState.isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Initializing Vultisig SDK...</p>
      </div>
    )
  }

  if (appState.error) {
    return (
      <div className="error-screen">
        <h1>Error</h1>
        <p>{appState.error}</p>
      </div>
    )
  }

  const currentVault = appState.activeVaultId
    ? appState.openVaults.get(appState.activeVaultId)
    : null

  return (
    <>
      <Layout
        sidebar={
          <>
            <VaultCreator onVaultCreated={handleVaultCreated} />
            <VaultImporter onVaultImported={handleVaultImported} />
          </>
        }
        main={
          <>
            <VaultTabs
              openVaults={Array.from(appState.openVaults.values())}
              allVaults={appState.vaultMetadata}
              activeVaultId={appState.activeVaultId}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
              onTabOpen={handleTabOpen}
            />
            {currentVault ? (
              <>
                <VaultInfo vault={currentVault} />
                <BalanceDisplay vault={currentVault} />
                <TransactionForm vault={currentVault} />
              </>
            ) : (
              <div className="empty-state">
                <h2>No Vault Open</h2>
                <p>Create a new vault, import one, or open an existing vault from the list.</p>
              </div>
            )}
          </>
        }
        eventLog={
          <EventLog
            events={appState.events}
            onClear={handleClearEvents}
          />
        }
      />
      {toast && <Toast {...toast} />}
    </>
  )
}

export default App
```

---

## Phase 4: Component Implementation

### Step 4.1: Layout Components

Create `src/components/layout/Layout.tsx`:

```typescript
import { ReactNode } from 'react'
import Header from './Header'

interface LayoutProps {
  sidebar: ReactNode
  main: ReactNode
  eventLog: ReactNode
}

export default function Layout({ sidebar, main, eventLog }: LayoutProps) {
  return (
    <div className="app-container">
      <Header />
      <div className="app-body">
        <aside className="sidebar">{sidebar}</aside>
        <main className="main-content">{main}</main>
        <aside className="event-log-panel">{eventLog}</aside>
      </div>
    </div>
  )
}
```

Create `src/components/layout/Header.tsx`:

```typescript
import { APP_NAME, APP_VERSION } from '@/constants/config'

export default function Header() {
  return (
    <header className="app-header">
      <h1>{APP_NAME}</h1>
      <span className="version">v{APP_VERSION}</span>
    </header>
  )
}
```

### Step 4.2: Vault Components

Create `src/components/vault/VaultCreator.tsx`:

```typescript
import { useState } from 'react'
import type { Vault } from '@vultisig/sdk'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Modal from '@/components/common/Modal'
import { getSDK } from '@/utils/sdk'

interface VaultCreatorProps {
  onVaultCreated: (vault: Vault) => void
}

export default function VaultCreator({ onVaultCreated }: VaultCreatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [vaultId, setVaultId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!formData.name || !formData.email || !formData.password) {
      setError('All fields are required')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsLoading(true)

    try {
      const sdk = getSDK()
      const result = await sdk.createFastVault({
        name: formData.name,
        password: formData.password,
        email: formData.email,
      })

      if (result.verificationRequired) {
        setVaultId(result.vaultId)
        setStep('verify')
      } else {
        onVaultCreated(result.vault)
        handleClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (!vaultId) {
        throw new Error('No vault ID')
      }

      const { getSDK } = await import('@/utils/sdk')
      const sdk = getSDK()
      const vault = await sdk.verifyVault(vaultId, verificationCode)

      onVaultCreated(vault)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setStep('form')
    setVaultId(null)
    setFormData({ name: '', email: '', password: '', confirmPassword: '' })
    setVerificationCode('')
    setError(null)
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="primary" fullWidth>
        Create New Vault
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Create Fast Vault">
        {step === 'form' ? (
          <form onSubmit={handleSubmit} className="vault-form">
            <Input
              label="Vault Name"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Vault"
              required
            />
            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="your@email.com"
              required
            />
            <Input
              label="Password"
              type="password"
              value={formData.password}
              onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Min. 8 characters"
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={formData.confirmPassword}
              onChange={e => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
              placeholder="Re-enter password"
              required
            />
            {error && <div className="error-message">{error}</div>}
            <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
              Create Vault
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="vault-form">
            <p className="info-message">
              A verification code has been sent to <strong>{formData.email}</strong>.
              Please enter it below to complete vault creation.
            </p>
            <Input
              label="Verification Code"
              value={verificationCode}
              onChange={e => setVerificationCode(e.target.value)}
              placeholder="123456"
              required
            />
            {error && <div className="error-message">{error}</div>}
            <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
              Verify & Complete
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
```

Create `src/components/vault/VaultImporter.tsx`:

```typescript
import { useState } from 'react'
import type { Vault } from '@vultisig/sdk'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'

interface VaultImporterProps {
  onVaultImported: (vaults: Vault[]) => void
}

export default function VaultImporter({ onVaultImported }: VaultImporterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files)
    setError(null)
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select at least one vault file')
      return
    }

    setIsLoading(true)

    try {
      const { getSDK } = await import('@/utils/sdk')
      const sdk = getSDK()
      const importedVaults: Vault[] = []

      // Import each file
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]

        // Read file content
        const content = await readFileAsText(file)

        try {
          // Parse vault data
          const vaultData = JSON.parse(content)

          // Import vault through SDK
          const vault = await sdk.importVault(vaultData)
          importedVaults.push(vault)
        } catch (fileError) {
          console.error(`Failed to import ${file.name}:`, fileError)
          // Continue with other files instead of failing completely
        }
      }

      if (importedVaults.length === 0) {
        throw new Error('Failed to import any vaults. Check file format.')
      }

      onVaultImported(importedVaults)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import vaults')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setSelectedFiles(null)
    setError(null)
  }

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Import Vault(s)
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Import Vault Files">
        <form onSubmit={handleImport} className="vault-form">
          <div className="form-field">
            <label htmlFor="vault-files">Select Vault File(s)</label>
            <input
              id="vault-files"
              type="file"
              accept=".vult,.json"
              multiple
              onChange={handleFileChange}
              className="file-input"
            />
            <p className="help-text">
              Select one or more .vult files to import. Multiple vaults will be imported simultaneously.
            </p>
          </div>

          {selectedFiles && selectedFiles.length > 0 && (
            <div className="selected-files">
              <strong>Selected files ({selectedFiles.length}):</strong>
              <ul>
                {Array.from(selectedFiles).map((file, index) => (
                  <li key={index}>{file.name}</li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={isLoading}
            disabled={!selectedFiles || selectedFiles.length === 0}
          >
            Import {selectedFiles && selectedFiles.length > 1 ? `${selectedFiles.length} Vaults` : 'Vault'}
          </Button>
        </form>
      </Modal>
    </>
  )
}
```

Create `src/components/vault/VaultTabs.tsx`:

```typescript
import { useState } from 'react'
import type { Vault } from '@vultisig/sdk'
import type { VaultListItem } from '@/types'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { shortenAddress } from '@/utils/formatting'

interface VaultTabsProps {
  openVaults: Vault[]
  allVaults: VaultListItem[]
  activeVaultId: string | null
  onTabSwitch: (vaultId: string) => void
  onTabClose: (vaultId: string) => void
  onTabOpen: (vaultId: string) => void
}

export default function VaultTabs({
  openVaults,
  allVaults,
  activeVaultId,
  onTabSwitch,
  onTabClose,
  onTabOpen,
}: VaultTabsProps) {
  const [showVaultList, setShowVaultList] = useState(false)

  const handleCloseTab = (e: React.MouseEvent, vaultId: string) => {
    e.stopPropagation()
    onTabClose(vaultId)
  }

  const handleOpenVault = (vaultId: string) => {
    onTabOpen(vaultId)
    setShowVaultList(false)
  }

  // Get vaults not currently open
  const closedVaults = allVaults.filter(
    vault => !openVaults.some(open => open.id === vault.id)
  )

  return (
    <>
      <div className="vault-tabs">
        <div className="tabs-list">
          {openVaults.map(vault => (
            <div
              key={vault.id}
              className={`tab ${activeVaultId === vault.id ? 'active' : ''}`}
              onClick={() => onTabSwitch(vault.id)}
            >
              <div className="tab-content">
                <span className="tab-icon">🔐</span>
                <span className="tab-name">{vault.name}</span>
                <span className="tab-id">{shortenAddress(vault.id, 4)}</span>
              </div>
              <button
                className="tab-close"
                onClick={(e) => handleCloseTab(e, vault.id)}
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          ))}

          {closedVaults.length > 0 && (
            <button
              className="tab-add"
              onClick={() => setShowVaultList(true)}
              aria-label="Open vault"
            >
              + Open Vault
            </button>
          )}
        </div>

        {openVaults.length === 0 && (
          <div className="tabs-empty">
            No vaults open. Create or import a vault to get started.
          </div>
        )}
      </div>

      <Modal
        isOpen={showVaultList}
        onClose={() => setShowVaultList(false)}
        title="Open Vault"
      >
        <div className="vault-list-modal">
          {closedVaults.length === 0 ? (
            <p className="empty-message">All vaults are already open.</p>
          ) : (
            <div className="vault-list">
              {closedVaults.map(vault => (
                <div
                  key={vault.id}
                  className="vault-list-item"
                  onClick={() => handleOpenVault(vault.id)}
                >
                  <div className="vault-list-item-content">
                    <div className="vault-list-item-header">
                      <span className="vault-name">{vault.name}</span>
                      {vault.isEncrypted && (
                        <span className="badge badge-encrypted">Encrypted</span>
                      )}
                    </div>
                    <div className="vault-list-item-details">
                      <span className="vault-id">{shortenAddress(vault.id, 6)}</span>
                      <span className="vault-chains">{vault.chainCount} chains</span>
                    </div>
                  </div>
                  <div className="vault-list-item-action">
                    <Button variant="secondary" size="small">
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
```

**Note**: Due to length constraints, I'll provide the structure and key snippets for remaining components. Each should follow similar patterns.

### Step 4.3: Common Components

Create basic reusable components in `src/components/common/`:

**Button.tsx**: Standard button with loading state
**Input.tsx**: Form input with label
**Select.tsx**: Dropdown select
**Modal.tsx**: Modal dialog overlay
**Spinner.tsx**: Loading spinner
**Toast.tsx**: Toast notification system

### Step 4.4: Event Log Component

Create `src/components/events/EventLog.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import type { EventLogEntry } from '@/types'
import { formatEventTime, getEventColor } from '@/utils/events'
import Button from '@/components/common/Button'

interface EventLogProps {
  events: EventLogEntry[]
  onClear: () => void
}

export default function EventLog({ events, onClear }: EventLogProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events, autoScroll])

  return (
    <div className="event-log">
      <div className="event-log-header">
        <h3>Event Log</h3>
        <div className="event-log-controls">
          <label>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <Button onClick={onClear} variant="secondary" size="small">
            Clear
          </Button>
        </div>
      </div>
      <div ref={logRef} className="event-log-content">
        {events.length === 0 ? (
          <div className="event-log-empty">No events yet</div>
        ) : (
          events.map(event => (
            <div
              key={event.id}
              className="event-log-entry"
              style={{ borderLeftColor: getEventColor(event.type) }}
            >
              <div className="event-time">{formatEventTime(event.timestamp)}</div>
              <div className="event-source">{event.source}</div>
              <div className="event-message">{event.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

---

## Phase 5: Styling with Tailwind CSS

With Tailwind CSS configured, you'll style components inline using utility classes. This eliminates the need for separate CSS files and provides instant visual feedback.

### Key Tailwind Patterns

**1. Layout Components with Tailwind**

```tsx
export default function Layout({ sidebar, main, eventLog }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen">
      <Header />
      <div className="grid grid-cols-[300px_1fr_400px] flex-1 overflow-hidden lg:grid-cols-1">
        <aside className="border-r border-gray-200 overflow-y-auto p-4 lg:hidden">
          {sidebar}
        </aside>
        <main className="overflow-y-auto p-6">
          {main}
        </main>
        <aside className="border-l border-gray-200 overflow-y-auto p-4 lg:hidden">
          {eventLog}
        </aside>
      </div>
    </div>
  )
}
```

**2. Vault Tabs with Tailwind**

Update `src/components/vault/VaultTabs.tsx` to use Tailwind classes:

```tsx
export default function VaultTabs({ openVaults, activeVaultId, onTabSwitch, onTabClose }: VaultTabsProps) {
  return (
    <div className="bg-white border-b-2 border-gray-200 mb-5">
      <div className="flex items-center gap-1 p-2 overflow-x-auto scrollbar-thin">
        {openVaults.map(vault => (
          <div
            key={vault.id}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-t-md cursor-pointer
              transition-all min-w-[150px] max-w-[250px] border
              ${activeVaultId === vault.id
                ? 'bg-primary text-white border-primary'
                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }
            `}
            onClick={() => onTabSwitch(vault.id)}
          >
            <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
              <span className="text-base">🔐</span>
              <span className="font-medium truncate">{vault.name}</span>
              <span className="text-xs opacity-70 font-mono">
                {shortenAddress(vault.id, 4)}
              </span>
            </div>
            <button
              className="text-xl opacity-60 hover:opacity-100 px-1 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(vault.id)
              }}
            >
              ×
            </button>
          </div>
        ))}

        {closedVaults.length > 0 && (
          <button
            className="px-4 py-2 border border-dashed border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 hover:border-primary hover:text-primary transition-all text-sm whitespace-nowrap"
            onClick={() => setShowVaultList(true)}
          >
            + Open Vault
          </button>
        )}
      </div>

      {openVaults.length === 0 && (
        <div className="p-4 text-center text-gray-500 text-sm">
          No vaults open. Create or import a vault to get started.
        </div>
      )}
    </div>
  )
}
```

**3. Button Component with Tailwind**

Create `src/components/common/Button.tsx`:

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'small' | 'medium' | 'large'
  isLoading?: boolean
  fullWidth?: boolean
}

export default function Button({
  children,
  variant = 'primary',
  size = 'medium',
  isLoading = false,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = 'btn font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed'

  const variantClasses = {
    primary: 'bg-primary text-white hover:bg-primary-600',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    danger: 'bg-error text-white hover:bg-red-600',
  }

  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-2',
    large: 'px-6 py-3 text-lg',
  }

  const widthClass = fullWidth ? 'w-full' : ''

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </span>
      ) : children}
    </button>
  )
}
```

**4. Input Component with Tailwind**

Create `src/components/common/Input.tsx`:

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export default function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <input
        className={`
          w-full px-3 py-2 border border-gray-300 rounded-lg
          focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
          disabled:bg-gray-100 disabled:cursor-not-allowed
          ${error ? 'border-error' : ''}
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-error">{error}</p>
      )}
    </div>
  )
}
```

**5. Modal Component with Tailwind**

Create `src/components/common/Modal.tsx`:

```tsx
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  )
}
```

**6. Event Log with Tailwind**

Update `src/components/events/EventLog.tsx`:

```tsx
export default function EventLog({ events, onClear }: EventLogProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const eventColors = {
    info: 'border-blue-500',
    success: 'border-green-500',
    warning: 'border-yellow-500',
    error: 'border-red-500',
    balance: 'border-purple-500',
    transaction: 'border-cyan-500',
    signing: 'border-pink-500',
    vault: 'border-indigo-500',
    chain: 'border-teal-500',
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <h3 className="text-lg font-semibold">Event Log</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
          <Button variant="secondary" size="small" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>

      {/* Log Content */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {events.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No events yet</div>
        ) : (
          events.map(event => (
            <div
              key={event.id}
              className={`border-l-4 ${eventColors[event.type]} bg-gray-50 p-2 text-sm`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                  {formatEventTime(event.timestamp)}
                </span>
                <span className="text-xs font-medium text-gray-600 uppercase">
                  {event.source}
                </span>
                <span className="flex-1 text-gray-800">{event.message}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

### Benefits of Using Tailwind

1. **No CSS File Management**: All styles are in the component
2. **Autocomplete**: VS Code IntelliSense shows available classes
3. **Responsive by Default**: Use `md:`, `lg:` prefixes for breakpoints
4. **Consistent Design**: Spacing, colors follow design tokens
5. **Smaller Bundle**: Only used classes are included
6. **Faster Development**: No context switching between files

---

## Phase 6: Testing & Verification

### Test Checklist

**Vault Management**:
- [ ] Create fast vault with email verification
- [ ] Import single vault from .vult file
- [ ] Import multiple vaults at once (batch import)
- [ ] Export vault to file
- [ ] Open vault in new tab
- [ ] Switch between open vault tabs
- [ ] Close vault tab
- [ ] Multiple vaults open simultaneously with independent operations
- [ ] Lock and unlock vault with password
- [ ] Event log shows events from all open vaults with vault name prefix

**Wallet Operations**:
- [ ] Display addresses for all chains
- [ ] Check balance for single chain
- [ ] Check balances for all chains
- [ ] Display portfolio value in USD/EUR
- [ ] Add new chain to vault
- [ ] Remove chain from vault

**Transactions**:
- [ ] Prepare send transaction
- [ ] Sign transaction with progress tracking
- [ ] Broadcast transaction
- [ ] Display transaction hash and explorer link
- [ ] Handle transaction errors

**Event Log**:
- [ ] All events are logged in real-time
- [ ] Auto-scroll works correctly
- [ ] Events are color-coded by type
- [ ] Clear log button works
- [ ] Log persists during vault switches

**UI/UX**:
- [ ] All forms have validation
- [ ] Loading states show spinners
- [ ] Error messages display in toasts
- [ ] Responsive design works on mobile
- [ ] No console errors

### Manual Testing Script

```bash
# 1. Start dev server
yarn dev

# 2. Test vault creation
- Click "Create New Vault"
- Enter name, email, password
- Check email for verification code
- Enter code and verify
- Verify vault appears in list

# 3. Test balance checking
- Select vault
- Add Ethereum chain
- View address
- Click "Check Balances"
- Verify balance display

# 4. Test transaction
- Click "Send Transaction"
- Enter recipient, amount
- Click "Prepare"
- Click "Sign"
- Verify progress updates
- Click "Broadcast"
- Verify transaction hash

# 5. Test event log
- Perform various operations
- Verify all events appear
- Test auto-scroll toggle
- Test clear button
- Test event colors
```

---

## Phase 7: Documentation

### Create README.md

```markdown
# Vultisig Browser Example

Browser-based example application demonstrating the Vultisig SDK for fast vault management.

## Features

- 🔐 Create fast vaults with email verification
- 📦 Import/export vault files
- 💰 Check balances across multiple chains
- 💸 Send transactions with 2-of-2 signing
- 📊 Real-time event logging
- 🎨 Modern React UI

## Getting Started

### Prerequisites
- Node.js 18+
- Yarn

### Installation
\`\`\`bash
yarn install
\`\`\`

### Development
\`\`\`bash
yarn dev
\`\`\`

Open http://localhost:3000

### Build
\`\`\`bash
yarn build
yarn preview
\`\`\`

## Usage

### Create a Vault
1. Click "Create New Vault"
2. Enter vault name, email, and password
3. Check email for verification code
4. Enter code to complete creation

### Check Balances
1. Select a vault from the list
2. Add chains using the Chain Manager
3. Click "Check Balances" to fetch balances

### Send Transaction
1. Select chain and enter recipient address
2. Enter amount to send
3. Click "Prepare Transaction"
4. Review and click "Sign"
5. Wait for signing to complete
6. Click "Broadcast"

## Architecture

- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **Vultisig SDK**: Wallet functionality
- **IndexedDB**: Vault storage (via SDK)
- **LocalStorage**: App settings

## Project Structure

See [BROWSER_EXAMPLE_IMPLEMENTATION.md](../../docs/plans/BROWSER_EXAMPLE_IMPLEMENTATION.md) for detailed architecture and implementation guide.

## License

MIT
```

---

## Additional Recommendations

### Performance Optimizations

1. **Code Splitting**: Use React.lazy() for heavy components
2. **Memoization**: Use React.memo() for event log entries and tab components
3. **Debouncing**: Debounce balance refresh and form inputs
4. **Virtual Scrolling**: Use react-window for large event logs
5. **Tab Memory Management**: Consider unsubscribing from events for inactive tabs if many vaults are open
6. **Lazy Vault Loading**: Only load vault data when tab is opened, not all vaults at startup

### Security Considerations

1. **Password Handling**: Never log passwords, use secure input fields
2. **XSS Protection**: Sanitize all user inputs before display
3. **HTTPS Only**: Serve only over HTTPS in production
4. **CSP Headers**: Configure Content Security Policy
5. **Vault Export**: Warn users about file security

### Accessibility

1. **ARIA Labels**: Add aria-label to all interactive elements
2. **Keyboard Navigation**: Support Tab, Enter, Escape keys
3. **Screen Reader**: Use semantic HTML (nav, main, aside)
4. **Focus Management**: Trap focus in modals
5. **Color Contrast**: WCAG AA compliant (4.5:1 ratio)

### Future Enhancements

1. **Dark Mode**: Toggle between light/dark themes
2. **Multi-Language**: i18n support (English, Spanish, Chinese)
3. **Transaction History**: Local cache of past transactions
4. **QR Codes**: Display addresses as QR codes
5. **Hardware Wallet**: Optional hardware wallet support
6. **Address Book**: Save frequently used addresses
7. **Gas Optimization**: Suggest optimal gas prices
8. **Batch Transactions**: Send multiple transactions at once

---

## Implementation Timeline Estimate

**Phase 1: Setup** (4-6 hours)
- Project configuration
- Dependencies installation (including Tailwind CSS)
- Build system setup

**Phase 2: Foundation** (6-8 hours)
- SDK initialization
- Utilities and helpers
- Base layout with Tailwind

**Phase 3: Vault Management** (10-12 hours)
- Create, import, export
- Vault tabs interface
- Lock/unlock functionality

**Phase 4: Wallet Features** (8-10 hours)
- Address display
- Balance checking
- Chain/token management

**Phase 5: Transactions** (12-15 hours)
- Transaction form
- Signing flow
- Broadcasting and tracking

**Phase 6: Event Log** (4-5 hours)
- Event display with Tailwind
- Filtering and controls
- Color-coded events

**Phase 7: Polish** (4-6 hours)
- Error handling
- Loading states
- Responsive design (built into Tailwind)
- Testing and bug fixes

**Total Estimated Time**: 48-62 hours (6-8 days for one developer)

**Time Saved with Tailwind**: ~15-17 hours compared to custom CSS

---

## Troubleshooting

### Common Issues

**Issue**: Tailwind classes not applying
- **Solution**: Verify `tailwind.config.js` content paths include all source files
- **Solution**: Check `@tailwind` directives are in `src/styles.css`
- **Solution**: Restart Vite dev server after config changes

**Issue**: Custom colors not working (e.g., `bg-primary`)
- **Solution**: Check custom colors are defined in `tailwind.config.js` under `theme.extend.colors`
- **Solution**: Use `bg-primary-500` format for specific shades

**Issue**: WASM loading fails
- **Solution**: Check vite-plugin-wasm is installed and configured
- **Solution**: Verify WASM files are in public directory

**Issue**: Buffer is not defined
- **Solution**: Check vite-plugin-node-polyfills configuration
- **Solution**: Add Buffer polyfill to index.html

**Issue**: IndexedDB quota exceeded
- **Solution**: Clear browser data
- **Solution**: Implement vault cleanup/archiving

**Issue**: Transaction signing timeout
- **Solution**: Check VultiServer connectivity
- **Solution**: Verify vault is unlocked
- **Solution**: Check network connection

**Issue**: Styles look broken in production build
- **Solution**: Ensure PostCSS is configured (`postcss.config.js`)
- **Solution**: Verify `autoprefixer` is installed
- **Solution**: Check Tailwind purge settings aren't removing needed classes

---

## Support

For questions or issues:
- GitHub Issues: [vultisig-sdk/issues](https://github.com/vultisig/vultisig-sdk/issues)
- Documentation: [SDK Docs](../../README.md)
- Examples: Check `clients/cli` for CLI reference

---

## Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---

## Notes for Developers

### Pre-Alpha Status

This project is in pre-alpha. Expect:
- Breaking changes in SDK APIs
- Frequent updates to dependencies
- Possible bugs and incomplete features
- Documentation changes

### Code Style

- Use TypeScript strict mode
- Follow React best practices (hooks, functional components)
- Keep components small and focused (<200 lines)
- Write descriptive variable names
- Add comments for complex logic
- Use async/await over promises

### Git Workflow

- Commit frequently with clear messages
- Use conventional commits format (feat:, fix:, docs:, etc.)
- Create feature branches from main
- Keep commits atomic and focused

---

## Key Feature Highlight: Multi-Vault Tab Interface

One of the standout features of this browser example is the **tab-based multi-vault interface**, which allows users to work with multiple vaults simultaneously. This feature differentiates it from simpler single-vault examples and provides a more powerful workflow.

### How It Works

1. **Multiple Vaults Open**: Users can have several vaults open at the same time, each in its own tab
2. **Independent Operations**: Each vault operates independently - you can check balances in one vault while signing a transaction in another
3. **Unified Event Log**: All events from all open vaults are logged in a single event log, with vault name prefixes for clarity
4. **Easy Switching**: Click tabs to switch between vaults instantly without reloading
5. **Batch Import**: Import multiple .vult files at once, and they all open in separate tabs
6. **Lazy Loading**: Vaults are only loaded from storage when their tab is opened, not all at startup

### Benefits

- **Productivity**: Manage multiple wallets without switching between windows or apps
- **Real-time Monitoring**: Watch events from all vaults in one place
- **User-Friendly**: Familiar browser tab interface that users already understand
- **Efficient**: Only loads vault data when needed, reducing memory usage
- **Flexible**: Open and close vaults as needed throughout your session

### Implementation Details

- Uses `Map<string, Vault>` to track open vaults efficiently
- Event handlers include vault context to distinguish events
- Toast notifications only show for the active vault to avoid spam
- Tab close button automatically switches to another tab if closing the active one
- Modal dialog for opening additional vaults from the available vault list

This multi-vault design makes the browser example ideal for power users and demonstrates advanced state management patterns for React applications using the Vultisig SDK.

---

## Conclusion

This implementation guide provides a comprehensive roadmap for building a browser-based Vultisig SDK example with a modern tab-based multi-vault interface using **React + Vite + Tailwind CSS**. Follow the phases sequentially, test thoroughly at each stage, and refer to the existing shell example for reference patterns.

The use of **Tailwind CSS** significantly streamlines development by:
- Eliminating the need for separate CSS files
- Providing instant visual feedback with utility classes
- Ensuring consistent design through built-in design tokens
- Reducing development time by ~15-17 hours compared to custom CSS

The resulting application will serve as both a functional demo and a reference implementation for developers integrating the Vultisig SDK into browser-based applications, showcasing advanced features like multi-vault management, real-time event logging, and modern UI development practices.

For questions or clarifications during implementation, refer to:
- CLI: `clients/cli/` (feature reference)
- SDK source: `packages/sdk/` (API details)
- Documentation: `docs/` (guides and architecture)
