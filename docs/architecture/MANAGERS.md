# SDK Manager Pattern

**Last Updated:** 2025-11-01

---

## Overview

The Vultisig SDK uses a **Manager Pattern** to organize functionality into dedicated managers that handle specific concerns. This architectural decision provides:

- **Clear Separation of Responsibilities** - Each manager has a well-defined purpose
- **Modular Architecture** - Managers can be composed and configured independently
- **Testability** - Each manager can be tested in isolation
- **Dependency Injection** - Managers are injected where needed, avoiding tight coupling

---

## Manager Hierarchy

```
VultisigSDK
  ├── VaultManager      - Vault lifecycle and storage
  ├── ChainManager      - Chain configuration and defaults
  ├── WASMManager       - WASM module initialization
  ├── ServerManager     - Server communication
  └── AddressBookManager - Global address book (across vaults)
```

---

## VaultManager

### Overview

**Location:** [VaultManager.ts](../../packages/sdk/src/VaultManager.ts)

The `VaultManager` is responsible for all vault lifecycle operations including creation, import, export, storage, and active vault management.

### Responsibilities

1. **Vault Creation**
   - Fast vault creation (2-of-2 with VultiServer)
   - Secure vault creation (multi-device MPC) - *In Progress*
   - Vault type detection (fast vs secure)

2. **Vault Storage**
   - In-memory vault storage (Map-based)
   - Vault listing and retrieval
   - Vault deletion and cleanup
   - TODO: Persistent storage integration

3. **Vault Import/Export**
   - .vult file import with encryption support
   - Encryption status detection
   - Password validation
   - Error handling with specific error codes

4. **Service Injection**
   - Creates `VaultServices` instances
   - Injects services into `Vault` class
   - Avoids circular dependencies

5. **Active Vault Management**
   - Tracks currently active vault
   - Switches between vaults
   - Provides active vault state

### Key Methods

#### Vault Creation

```typescript
async createVault(
  name: string,
  options?: {
    type?: 'fast' | 'secure'
    password?: string
    email?: string
    onProgress?: (step: VaultCreationStep) => void
  }
): Promise<VaultClass>
```

**Description:** Creates a new vault (fast or secure based on type)

**Parameters:**
- `name` - Vault name
- `options.type` - 'fast' (default) or 'secure'
- `options.password` - Required for fast vaults
- `options.email` - Required for fast vaults (for server verification)
- `options.onProgress` - Progress callback for keygen updates

**Returns:** Created `Vault` instance (also sets as active vault)

**Example:**
```typescript
const vault = await vaultManager.createVault('My Wallet', {
  type: 'fast',
  password: 'secure-password',
  email: 'user@example.com',
  onProgress: (step) => {
    console.log(`${step.step}: ${step.message}`)
  }
})
```

---

#### Vault Import

```typescript
async addVault(file: File, password?: string): Promise<VaultClass>
```

**Description:** Imports a vault from a .vult file

**Parameters:**
- `file` - .vult file to import
- `password` - Password for encrypted vaults (optional for unencrypted)

**Returns:** Imported `Vault` instance (also sets as active vault)

**Error Handling:**
- `VaultImportError.INVALID_FILE_FORMAT` - Not a .vult file
- `VaultImportError.PASSWORD_REQUIRED` - Encrypted vault needs password
- `VaultImportError.INVALID_PASSWORD` - Wrong password provided
- `VaultImportError.CORRUPTED_DATA` - Invalid or corrupted vault data

**Example:**
```typescript
try {
  const vault = await vaultManager.addVault(file, 'my-password')
  console.log(`Imported vault: ${vault.data.name}`)
} catch (error) {
  if (error instanceof VaultImportError) {
    switch (error.code) {
      case VaultImportErrorCode.PASSWORD_REQUIRED:
        // Prompt user for password
        break
      case VaultImportErrorCode.INVALID_PASSWORD:
        // Show error message
        break
      // ... handle other cases
    }
  }
}
```

---

#### Encryption Check

```typescript
async isVaultFileEncrypted(file: File): Promise<boolean>
```

**Description:** Checks if a .vult file is encrypted before import

**Use Case:** Determine whether to prompt for password before calling `addVault()`

**Example:**
```typescript
const isEncrypted = await vaultManager.isVaultFileEncrypted(file)
if (isEncrypted) {
  const password = await promptUserForPassword()
  await vaultManager.addVault(file, password)
} else {
  await vaultManager.addVault(file)
}
```

---

#### Vault Listing

```typescript
async listVaults(): Promise<Summary[]>
```

**Description:** Get summaries of all stored vaults

**Returns:** Array of vault summaries with metadata

**Summary Structure:**
```typescript
interface Summary {
  id: string                    // Vault ID (ECDSA public key)
  name: string                  // Vault name
  type: 'fast' | 'secure'       // Vault type
  chains: string[]              // Active chains
  createdAt: number             // Creation timestamp
  lastModified: number          // Last modification timestamp
  isEncrypted: boolean          // Encryption status
  totalSigners: number          // Number of signers
  threshold: number             // Signature threshold
  signers: SignerInfo[]         // Signer details
  keys: {
    ecdsa: string               // ECDSA public key
    eddsa: string               // EdDSA public key
    hexChainCode: string        // HD chain code
  }
  currency: string              // Display currency
}
```

---

#### Active Vault Management

```typescript
setActiveVault(vault: VaultClass): void
getActiveVault(): VaultClass | null
hasActiveVault(): boolean
```

**Description:** Manage the currently active vault

**Example:**
```typescript
// Set active vault
vaultManager.setActiveVault(vault)

// Check if active vault exists
if (vaultManager.hasActiveVault()) {
  const active = vaultManager.getActiveVault()
  const balance = await active.balance('Ethereum')
}
```

---

#### Vault Deletion

```typescript
async deleteVault(vault: VaultClass): Promise<void>
async clearVaults(): Promise<void>
```

**Description:** Delete a single vault or clear all vaults

**Example:**
```typescript
// Delete specific vault
await vaultManager.deleteVault(vault)

// Clear all vaults (use with caution!)
await vaultManager.clearVaults()
```

---

### Service Injection Pattern

The `VaultManager` implements the **Service Injection Pattern** to avoid circular dependencies:

**Problem:**
```
VultisigSDK → VaultManager → ServerManager → Vault → ServerManager (circular!)
```

**Solution:**
`VaultManager` creates services and injects them into `Vault` instances:

```typescript
private createVaultServices(): VaultServices {
  const strategyFactory = createDefaultStrategyFactory(this.wasmManager)

  return {
    addressService: new AddressService(strategyFactory),
    balanceService: new BalanceService(strategyFactory, blockchairFirstResolver),
    signingService: new SigningService(strategyFactory),
    fastSigningService: new FastSigningService(this.serverManager, strategyFactory)
  }
}

createVaultInstance(vaultData: Vault): VaultClass {
  return new VaultClass(
    vaultData,
    this.createVaultServices(),  // Inject services
    this.config
  )
}
```

**Benefits:**
- No circular dependencies
- Vault receives fully configured services
- Easy to test (inject mock services)
- Services are shared across vault instances (created once)

---

### Configuration

```typescript
constructor(
  private wasmManager: WASMManager,
  private serverManager: ServerManager,
  private config: VaultConfig
)
```

**Dependencies:**
- `wasmManager` - For WASM module initialization
- `serverManager` - For server-assisted operations
- `config` - SDK-level configuration (default chains, currency)

**VaultConfig:**
```typescript
interface VaultConfig {
  defaultChains?: string[]      // Default chains for new vaults
  defaultCurrency?: string      // Default currency for display
}
```

---

## ChainManager

### Overview

**Location:** [ChainManager.ts](../../packages/sdk/src/ChainManager.ts)

The `ChainManager` handles SDK-level chain configuration, including default chains for new vaults and global currency settings.

### Responsibilities

1. **Chain Configuration**
   - Set and get default chains for new vaults
   - Validate chain lists against supported chains
   - Normalize chain identifiers

2. **Currency Management**
   - Set global default currency (USD, EUR, etc.)
   - Provide currency defaults to vaults

3. **Delegation to ChainConfig**
   - Acts as a thin wrapper around `ChainConfig`
   - Provides SDK-level state management
   - Single source of truth for supported chains

### Key Methods

```typescript
// Get all supported chains (immutable)
getSupportedChains(): string[]

// Set SDK-level default chains (with validation)
setDefaultChains(chains: string[]): void

// Get SDK-level default chains
getDefaultChains(): string[]

// Set global default currency
setDefaultCurrency(currency: string): void

// Get global default currency
getDefaultCurrency(): string
```

### Default Chains

By default, the SDK uses **5 top chains**:
- Bitcoin
- Ethereum
- Solana
- THORChain
- Ripple

These can be customized per SDK instance:

```typescript
const chainManager = new ChainManager({
  defaultChains: ['Ethereum', 'Bitcoin', 'Polygon'],
  defaultCurrency: 'EUR'
})

// Update defaults later
chainManager.setDefaultChains(['Ethereum', 'Arbitrum', 'Base'])
```

### Validation

The `ChainManager` validates chain lists against `ChainConfig`:

```typescript
try {
  chainManager.setDefaultChains(['Ethereum', 'InvalidChain'])
} catch (error) {
  // VaultError: Unsupported chains: InvalidChain
  // Supported chains: Ethereum, Bitcoin, Solana, ...
}
```

### Configuration Persistence

**Status:** TODO

Future versions will persist configuration to storage:
```typescript
setDefaultChains(chains: string[]): void {
  this.defaultChains = validation.valid
  // TODO: Save config to storage
}
```

---

## WASMManager

### Overview

**Location:** [WASMManager.ts](../../packages/sdk/src/wasm/WASMManager.ts)

The `WASMManager` handles initialization and management of all WebAssembly modules used by the SDK.

### Responsibilities

1. **WASM Module Loading**
   - WalletCore (address derivation, crypto operations)
   - DKLS (ECDSA 2-party MPC)
   - Schnorr (EdDSA 2-party MPC)

2. **Lazy Loading**
   - Modules loaded on first access
   - Reduces initial SDK load time
   - Memoization prevents duplicate loading

3. **Custom Paths**
   - Support custom CDN URLs for DKLS and Schnorr
   - WalletCore uses default paths

4. **Parallel Initialization**
   - Load all modules concurrently for speed
   - Optional upfront initialization

### WASM Modules

#### WalletCore
**Purpose:** Address derivation and cryptographic operations

**Initialization:**
```typescript
const walletCore = await wasmManager.getWalletCore()
```

**Note:** Custom paths not supported (uses default from `@trustwallet/wallet-core`)

---

#### DKLS (ECDSA)
**Purpose:** 2-party ECDSA MPC signing

**Initialization:**
```typescript
await wasmManager.initializeDkls()
```

**Custom Path:**
```typescript
const wasmManager = new WASMManager({
  wasmPaths: {
    dkls: 'https://cdn.example.com/dkls.wasm'
  }
})
```

---

#### Schnorr (EdDSA)
**Purpose:** 2-party EdDSA MPC signing (for Solana, etc.)

**Initialization:**
```typescript
await wasmManager.initializeSchnorr()
```

**Custom Path:**
```typescript
const wasmManager = new WASMManager({
  wasmPaths: {
    schnorr: 'https://cdn.example.com/schnorr.wasm'
  }
})
```

---

### Configuration

```typescript
interface WASMConfig {
  autoInit?: boolean            // Pre-load modules on SDK init
  wasmPaths?: {
    walletCore?: string         // Not supported (ignored)
    dkls?: string               // Custom DKLS WASM URL
    schnorr?: string            // Custom Schnorr WASM URL
  }
}
```

**Example:**
```typescript
const wasmManager = new WASMManager({
  autoInit: true,  // Pre-load all modules
  wasmPaths: {
    dkls: 'https://custom-cdn.com/dkls.wasm',
    schnorr: 'https://custom-cdn.com/schnorr.wasm'
  }
})
```

---

### Lazy Loading with Memoization

The `WASMManager` uses `memoizeAsync` for efficient lazy loading:

```typescript
private getWalletCoreInit = memoizeAsync(() => initWasm())
private getDklsInit = memoizeAsync((wasmUrl?) => initializeMpcLib('ecdsa', wasmUrl))
private getSchnorrInit = memoizeAsync((wasmUrl?) => initializeMpcLib('eddsa', wasmUrl))
```

**Benefits:**
- **Lazy:** Modules loaded only when needed
- **Memoized:** Each module loaded exactly once
- **Fast:** Subsequent calls return cached instance immediately

**Example:**
```typescript
// First call loads WASM (slow)
const wc1 = await wasmManager.getWalletCore()  // ~500ms

// Subsequent calls return cached instance (fast)
const wc2 = await wasmManager.getWalletCore()  // <1ms
```

---

### Parallel Initialization

For applications that need WASM upfront, use parallel initialization:

```typescript
// Initialize all modules in parallel
await wasmManager.initialize()

// All subsequent calls are instant
const walletCore = await wasmManager.getWalletCore()  // <1ms
await wasmManager.initializeDkls()                     // <1ms
await wasmManager.initializeSchnorr()                  // <1ms
```

**Performance:**
- Sequential: ~1500ms (500ms + 500ms + 500ms)
- Parallel: ~500ms (all load concurrently)

---

### Use Cases

#### On-Demand Loading (Default)
Best for web applications with fast initial load time:
```typescript
const wasmManager = new WASMManager()  // No autoInit

// WASM loaded only when needed
const vault = await sdk.createVault('My Wallet')  // Triggers WASM load
```

#### Upfront Loading
Best for applications that will use WASM immediately:
```typescript
const wasmManager = new WASMManager({ autoInit: true })

// All WASM modules loaded during SDK initialization
await sdk.initialize()  // Loads all WASM in parallel

// Operations are instant
const vault = await sdk.createVault('My Wallet')  // No WASM delay
```

#### Custom CDN
Best for enterprise deployments with private CDN:
```typescript
const wasmManager = new WASMManager({
  wasmPaths: {
    dkls: 'https://internal-cdn.company.com/dkls.wasm',
    schnorr: 'https://internal-cdn.company.com/schnorr.wasm'
  }
})
```

---

## ServerManager

### Overview

**Location:** [ServerManager.ts](../../packages/sdk/src/server/ServerManager.ts)

The `ServerManager` handles all server communications for VultiServer and MessageRelay.

### Responsibilities

1. **Fast Vault Creation**
   - 2-of-2 MPC keygen with VultiServer
   - Email verification
   - Session coordination

2. **Fast Signing**
   - Server-assisted signing
   - Message relay coordination
   - Multi-message signing support

3. **Vault Retrieval**
   - Download encrypted vaults from server
   - Vault verification

4. **Server Status**
   - Connectivity checks
   - Health monitoring

### Key Operations

See [ARCHITECTURE.md](./ARCHITECTURE.md#servermanager) for detailed documentation.

---

## AddressBookManager

### Overview

The `AddressBookManager` handles global address book management across all vaults.

### Responsibilities

1. **Address Book Management**
   - Store contact addresses
   - Organize by chain
   - Search and filter

2. **Global Scope**
   - Shared across all vaults
   - Persistent storage
   - Import/export

**Status:** Implementation details TBD

---

## Manager Pattern Benefits

### 1. Separation of Concerns
Each manager has a clear, well-defined responsibility:
- **VaultManager** - Vault lifecycle only
- **ChainManager** - Chain configuration only
- **WASMManager** - WASM loading only
- **ServerManager** - Server communication only

### 2. Testability
Managers can be tested in isolation:
```typescript
// Test VaultManager without real server
const mockServer = new MockServerManager()
const vaultManager = new VaultManager(wasmManager, mockServer, config)
```

### 3. Composability
Managers can be composed and configured:
```typescript
const sdk = new VultisigSDK({
  vaultManager: customVaultManager,
  chainManager: customChainManager,
  wasmManager: customWasmManager
})
```

### 4. Dependency Injection
Managers enable clean dependency injection:
```typescript
// VaultManager injects services into Vault
const vault = vaultManager.createVaultInstance(vaultData)

// Vault uses injected services, no direct dependencies
const balance = await vault.balance('Ethereum')  // Uses injected BalanceService
```

### 5. Modularity
Each manager is a self-contained module:
- Can be updated independently
- Clear API boundaries
- Easy to extend

---

## Summary

The **Manager Pattern** is a core architectural decision that enables:

1. **Clean Code** - Clear separation of concerns
2. **Testability** - Each manager testable in isolation
3. **Flexibility** - Easy to extend and customize
4. **Maintainability** - Well-defined boundaries and responsibilities
5. **Dependency Injection** - Avoids circular dependencies and tight coupling

For detailed API documentation, see:
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall SDK architecture
- [SERVICES.md](./SERVICES.md) - Service layer documentation
- [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) - Chain configuration system
