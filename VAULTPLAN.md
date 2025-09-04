# Vault-Centric Architecture Plan

## Executive Summary

VultisigSDK is a clean, vault-centric architecture with three primary classes:

- **`VultisigSDK`** - SDK
- **`VaultManager`** - Vault manager for multiple vaults
- **`Vault`** - Vault instance

### Minimal Integration Example

### Minimal Integration Example

```typescript
// 1. Import and initialize SDK
import { VultisigSDK, VaultManager } from 'vultisig-sdk'
const sdk = new VultisigSDK()

// 2. Create vault with progress updates
const vault = await VaultManager.create('My Vault', {
  password: 'password',
  email: 'user@example.com',
  onProgress: (step) => {
    console.log(`${step.step}: ${step.progress}% - ${step.message}`)
  }
})
await vault.verifyEmail('1234')

// 3. Get address/balance for transaction
const ethAddress = await vault.address('ethereum')
const ethBalance = await vault.balance('ethereum')          // Native ETH balance

// 4. Sign transaction with progress updates
const signature = await vault.sign({
  transaction: { to: '0x...', value: '1000000000000000000' },
  chain: 'ethereum',
  onProgress: (step) => {
    console.log(`${step.mode} signing: ${step.progress}% - ${step.message}`)
  }
})

console.log('Transaction signed:', signature.txHash)
```

### Secure Vault Example

```typescript
// 1. Create secure vault with multi-device setup
const vault = await VaultManager.create('My Secure Vault', {
  type: 'secure',
  keygenMode: 'local',
  onProgress: (step) => {
    console.log(`${step.step}: ${step.progress}% - ${step.message}`)
  }
})

// 2. Get address/balance for transaction
const btcAddress = await vault.address('bitcoin')
const btcBalance = await vault.balance('bitcoin')        // Native BTC balance

// 3. Multi-device signing with threshold
const signature = await vault.sign({
  transaction: { to: 'bc1q...', value: '50000' },
  chain: 'bitcoin',
  signingMode: 'relay',
  onProgress: (step) => {
    console.log(`${step.mode} signing: ${step.progress}% - ${step.message}`)
  }
})
```

# Architecture

## VultisigSDK Class
The SDK exposes an API for vault operations that are not specific to a Vault or set of Vaults. 
It contains SDK-wide config and holds the entry points for the underlying managers. 

```typescript
class VultisigSDK {
  // === PRIVATE PROPERTIES ===
  private vaultManager: VaultManager
  private serverManager: ServerManager
  private wasmManager: WASMManager

  constructor(config?: SDKConfig) {
    // Initialize managers
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this.vaultManager = new VaultManager()

    // Configure providers and settings
    this.configureProviders(config)
    
    // Initialize VaultManager with SDK instance and config
    VaultManager.init(this, config?.vaultManagerConfig)
    
    // Apply default settings
    if (config?.vaultManagerConfig?.defaultChains) {
      VaultManager.setDefaultChains(config.vaultManagerConfig.defaultChains)
    }
    if (config?.vaultManagerConfig?.defaultCurrency) {
      VaultManager.setDefaultCurrency(config.vaultManagerConfig.defaultCurrency)
    }
  }

  // === INITIALIZATION ===
  async initialize(): Promise<void>                           // Manual initialization (optional - auto-initializes on first use)
  isInitialized(): boolean                                    // Check if SDK is initialized
  private async ensureInitialized(): Promise<void>           // Internal auto-initialization helper

  // === VAULT OPERATIONS ===
  get vaultManager() { return VaultManager }                  // Access to VaultManager static class

  // === CHAIN OPERATIONS ===
  getSupportedChains(): string[]                              // Get all supported chains
  
  // === VALIDATION HELPERS ===
  static validateEmail(email: string): ValidationResult       // Validate email format
  static validatePassword(password: string): ValidationResult // Validate password strength
  static validateVaultName(name: string): ValidationResult    // Validate vault name
  
  // === SERVER STATUS ===
  async getServerStatus(): Promise<ServerStatus>              // Check server connectivity
  
  // === CONFIGURATION ===
  getConfig(): SDKConfig                                      // Get current SDK configuration
  updateConfig(config: Partial<SDKConfig>): Promise<void>     // Update SDK configuration

  // === PRIVATE METHODS ===
  private configureProviders(config?: SDKConfig): void       // Set up RPC endpoints, APIs
}
```
### SDK Interfaces

```typescript
interface SDKConfig {
  // Network configuration
  rpcEndpoints?: Record<string, string>     // Custom RPC endpoints per chain
  priceApiUrl?: string                      // Price API endpoint
  gasApiUrl?: string                        // Gas price API endpoint
  
  // Server endpoints
  serverEndpoints?: {
    messageRelay?: string                   // Message relay server URL
    vultiServer?: string                    // Main Vulti server URL
  }
  
  // Performance configuration
  defaultTimeout?: number                   // Request timeout in ms (default: 30000)
  retryAttempts?: number                    // Retry failed requests (default: 3)
  maxConcurrentRequests?: number            // Max concurrent network requests (default: 10)
  
  // Cache configuration
  cacheConfig?: {
    addressTTL?: number                     // Address cache TTL in ms (permanent by default)
    balanceTTL?: number                     // Balance cache TTL in ms (default: 300000 = 5min)
    gasTTL?: number                         // Gas price cache TTL in ms (default: 30000 = 30sec)
    priceTTL?: number                       // Price data cache TTL in ms (default: 60000 = 1min)
  }
  
  // WASM configuration
  wasmConfig?: {
    autoInit?: boolean                      // Auto-initialize WASM on first use (default: true)
    wasmPaths?: {
      walletCore?: string                   // Custom wallet core WASM path
      dkls?: string                         // Custom DKLS WASM path
      schnorr?: string                      // Custom Schnorr WASM path
    }
  }
}

interface ServerStatus {
  vultiServer: 'online' | 'offline'     // Fast vault server status
  messageRelay: 'online' | 'offline'  // Message relay server status
  lastChecked: number                               // Timestamp of last status check
}

interface ValidationResult {
  isValid: boolean                      // Whether validation passed
  errors?: string[]                     // Specific validation errors (if any)
}
```

## VaultManager Class
Manages multiple vaults and the vault lifecycle. Holds a default config that new vaults inherit from. Manages anything that a set of vaults needs access to (ie, AddressBook)

```typescript
class VaultManager {
  // === GLOBAL SETTINGS ===
  static config: VaultManagerConfig
  private static sdkInstance: VultisigSDK | null = null
  private static activeVault: Vault | null = null

  // === INITIALIZATION ===
  static init(sdk: VultisigSDK, config?: Partial<VaultManagerConfig>): void

  // === VAULT LIFECYCLE ===
  // Create new vault (automatically applies global chains/currency)
  static async create(
    name: string, 
    options?: {
      type?: VaultType                           // Vault type (default: 'fast')
      keygenMode?: KeygenMode                    // Keygen mode for secure vaults (default: 'relay')
      password?: string
      email?: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<Vault>

  // Add vault from file, applies global settings (chains/currency) to vault
  static async add(file: File, password?: string): Promise<Vault>

  // Load vault, applies global settings (chains/currency), makes active
  static async load(vault: Vault, password?: string):Promise<void>

  // List all stored vaults with their summaries
  static async list(): Promise<Summary[]>

  // Remove vault from storage
  static async remove(vault: Vault): Promise<void>

  // Clear all stored vaults
  static async clear(): Promise<void>

  // === ACTIVE VAULT MANAGEMENT ===
  static setActive(vault: Vault): void                        // Set active vault
  static getActive(): Vault | null                            // Get current active vault
  static hasActive(): boolean                                 // Check if there's an active vault

  // === GLOBAL CONFIGURATION ===
  static setDefaultChains(chains: string[]): Promise<void>    // Set global default chains
  static getDefaultChains(): string[]                         // Get global default chains
  static setDefaultCurrency(currency: string): Promise<void>  // Set global default currency
  static getDefaultCurrency(): string                         // Get global default currency
  static saveConfig(config: Partial<VaultManagerConfig>): Promise<void>  // Save configuration
  static getConfig(): VaultManagerConfig                      // Get current configuration

  // === ADDRESS BOOK (GLOBAL) ===
  static async addressBook(chain?: string): Promise<AddressBook>
  static async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void>
  static async removeAddressBookEntry(addresses: Array<{chain: string, address: string}>): Promise<void>
  static async updateAddressBookEntry(chain: string, address: string, name: string): Promise<void>

  // === VAULT SETTINGS INHERITANCE ===
  private static applyConfig(vault: Vault): Vault    // Apply global chains/currency to vault
}
```

### VaultManager Interfaces

```typescript
interface VaultManagerConfig {
  defaultChains: string[]                   // Global default chains for all vaults
  defaultCurrency: string                   // Global default currency for all vaults
}

interface VaultCreationStep {
  step: 'initializing' | 'keygen' | 'deriving_addresses' | 'fetching_balances' | 'applying_tokens' | 'complete'
  progress: number                          // Progress percentage (0-100)
  message: string                          // Human readable status message
  chainId?: string                         // Current chain being processed (if applicable)
}

interface SigningStep {
  step: 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
  progress: number                          // Progress percentage (0-100)
  message: string                          // Human readable status message
  mode: SigningMode                        // Current signing mode being used
  participantCount?: number                // Number of participants (for relay/local modes)
  participantsReady?: number               // Number of participants ready to sign
}

interface AddressBookEntry {
  chain: string                // Chain identifier (e.g., "ethereum", "bitcoin")
  address: string              // The actual address
  name: string                 // Human readable name
  source: 'saved' | 'vault'    // Whether manually saved or from user's other vaults
  vaultId?: string            // If source is 'vault', which vault it belongs to
  vaultName?: string          // If source is 'vault', the vault's name
  dateAdded: number           // Timestamp when added
}

interface AddressBook {
  saved: AddressBookEntry[]    // Manually saved addresses
  vaults: AddressBookEntry[]   // Addresses from user's other vaults
}
```

## Vault Class 
Core Vault operations that relate to a single vault.
Expose a summary, vault handling methods, chains/tokens/balances/values to manage in that vault.
Also handles signing, resharing, gas. 

```typescript
class Vault {
  summary(): Summary                      // Get vault summary

  // === VAULT OPERATIONS ===
  async export(password?: string): Promise<Blob>  // Export vault for backup
  async delete(): Promise<void>                   // Delete vault from storage
  async rename(newName: string): Promise<void>    // Rename vault

  // === CHAIN MANAGEMENT ===
  setChains(chains: string[]): void               // Set active chains
  addChain(chain: string): void                   // Add single chain
  removeChain(chain: string): void                // Remove single chain
  chains(): string[]                              // Get active chains

  // === ADDRESS MANAGEMENT ===
  async address(chain: string): Promise<string>                  // Single address
  async addresses(chains?: string[]): Promise<Record<string, string>> // Multiple addresses

  // === TOKEN MANAGEMENT ===
  setTokens(chain: string, tokens: Token[]): void          // Set tokens for a chain
  addToken(chain: string, token: Token): void              // Add single token to chain
  removeToken(chain: string, tokenId: string): void        // Remove single token from chain
  getTokens(chain: string): Token[]                        // Get tokens for chain

  // === Balance MANAGEMENT ===
  async balance(chain: string, tokenId?: string): Promise<Balance>
  async balances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Balance>>
  async updateBalance(chain: string, tokenId?: string): Promise<Balance>     // Force refresh balance
  async updateBalances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Record<string, Balance>>>  // Force refresh balances


  // === FIAT VALUE OPERATIONS (AUTO-CONVERTED) ===
  setCurrency(currency: string): Promise<void>    // Set vault currency
  getCurrency(): string                           // Get vault currency
  async getValue(chain: string, tokenId?: string): Promise<Value>  // Get fiat value for chain/token
  async getValues(chain: string): Promise<Record<string, Value>>   // Get all fiat values for chain
  async updateValues(chain: string | 'all'): Promise<void>              // Refresh price data from API
  async getTotalValue(): Promise<Value>                           // Calculate total vault value
  async updateTotalValue(): Promise<Value>                        // Update cached total value
  readonly lastValueUpdate?: Date         // When total value was last calculated

  // === VAULT OPERATIONS ===
  async reshare(options: { newParticipants: string[], removeParticipants?: string[] }): Promise<Vault>  // Change vault participants
  async sign(payload: SigningPayload): Promise<Signature>      // Sign transactions

  // === GAS ESTIMATION ===
  async gas(chain: string): Promise<GasInfo>
  async estimateGas(params: any): Promise<GasEstimate>

  // Email verification for fast vaults
  async verifyEmail(code: string): Promise<boolean>           // Verify email with code
  async resendVerificationEmail(): Promise<void>              // Resend verification email
}
```

### Vault Interfaces

```typescript
type VaultType = 'fast' | 'secure'
type KeygenMode = 'fast' | 'relay' | 'local'
type SigningMode = 'fast' | 'relay' | 'local'


interface VaultSigner {
  id: string                    // Signer identifier
  publicKey: string            // Signer's public key
  name?: string                // Optional display name
}
interface Config {
  chains: string[]                    // Chains active
  tokens: Record<string, Token[]>     // Tokens per chain
}

interface Summary {
  id: string                    // Vault ID (ECDSA public key)
  name: string                  // Display name
  isEncrypted: boolean            // Whether vault is encrypted
  createdAt: number            // Timestamp added to storage
  lastModified: number         // Last modification timestamp
  size: number                 // Estimated size in bytes
  type: VaultType               // Vault security type
  currency: string             // Preferred fiat currency (USD, EUR, etc.)
  chains: string[]             // Chains enabled for this vault
  tokens: Record<string, Token[]>  // Tokens per chain
  threshold: number                   // Minimum signers required
  totalSigners: number               // Total participants
  vaultIndex: number            // Which vault share this device owns
  signers: VaultSigner[]             // All participant details
  isBackedUp(): boolean        // Check if vault has been backed up
  keys: {                     // Public keys
    ecdsa: string
    eddsa: string
    hexChainCode: string
    hexEncryptionKey: string
  }
}

interface Balance {
  amount: string              // Balance amount
  symbol: string             // Token/coin symbol
  decimals: number           // Decimal places
  chainId: string            // Chain identifier
  tokenId?: string           // Token ID (if applicable)
}

interface SigningPayload {
  transaction: any            // Transaction data
  chain: string              // Chain identifier
  signingMode?: SigningMode   // Signing mode (defaults to vault type)
  onProgress?: (step: SigningStep) => void  // Progress callback
}

interface Signature {
  signature: string          // Hex signature
  txHash?: string           // Transaction hash (if broadcasted)
}

interface GasInfo {
  chainId: string           // Chain identifier
  gasPrice: string          // Current gas price (in chain's units)
  gasPriceGwei?: string     // Gas price in Gwei (for EVM chains)
  priorityFee?: string      // Priority fee (for EVM EIP-1559)
  maxFeePerGas?: string     // Max fee per gas (for EVM EIP-1559)

  lastUpdated: number       // Timestamp of gas price data
}

interface GasEstimate {
  gasLimit: number          // Estimated gas limit
  gasPrice: string          // Gas price used for estimate
  totalCost: {
    baseToken: string       // Total cost in base token (e.g., "0.0012 ETH")
    usd: string            // Total cost in USD (e.g., "3.85")
    symbol: string         // Currency symbol (e.g., "$")
  }
  breakdown?: {
    gasLimit: number        // Gas limit used
    gasPrice: string        // Gas price used
    priorityFee?: string    // Priority fee (if EIP-1559)
    maxFeePerGas?: string   // Max fee per gas (if EIP-1559)
  }
  chainId: string           // Chain identifier
}

interface Token {
  id: string                    // Unique token identifier
  symbol: string               // Token symbol (e.g., "USDC", "ETH")
  name: string                 // Human readable name
  decimals: number             // Token decimals
  contractAddress?: string     // Contract address (for ERC20, etc.)
  chainId: string              // Which chain this token belongs to
  logoUrl?: string             // Token logo URL
  isNative?: boolean           // Whether this is the chain's native token
}

interface Value {
  amount: string              // Fiat amount (e.g., "1234.56")
  currency: string           // Currency code (e.g., "USD", "EUR")
  symbol: string             // Currency symbol (e.g., "$", "€")
  rate: number              // Exchange rate used
  lastUpdated: number       // Timestamp of rate
}
```


## Vault Modes

### **Vault Types:**
- **Fast**: 2-of-2 threshold with VultiServer (default)
- **Secure**: Multi-signature with user devices only

### **Secure Vault Keygen:**
- **Relay**: Key generation via relay network (default)
- **Local**: Direct P2P key generation

## Signing Modes

### **Fast**: VultiServer co-signing (instant)
### **Relay**: Multi-device signing via relay network  
### **Local**: Direct P2P device signing

### **Defaults:**
- **Fast vault** → **Fast signing**
- **Secure vault** → **Relay signing**
- Override by specifying `signingMode` in transaction payload


### Auto-Population Behavior
When a new vault is created:
1. **Default Chains**: Automatically populate with `VaultManager.getDefaultChains()`
2. **Addresses**: Derive addresses for all default chains and cache them
3. **Balances**: Fetch initial balances and cache
4. **Currency**: Set vault currency to `VaultManager.getDefaultCurrency()`
5. **Default Tokens**: Add popular tokens for each chain (USDC, USDT for Ethereum, etc.)

When a vault is imported from file:
1. **Merge Global Settings**: Apply VaultManager's global chains to vault (union with existing chains)
2. **Update Currency**: Set vault currency to VaultManager's global currency setting
3. **Derive New Addresses**: Derive addresses for any newly added chains
4. **Refresh Balances**: Optionally refresh balances for all chains


## Caching Strategy

### Address Caching (Permanent)
- Cache addresses per vault instance
- Never re-derive same chain for same vault
- Clear cache only when vault changes

### Balance Caching (TTL: 5 minutes)
- Cache balances with timestamp
- Automatic refresh after TTL expires
- Manual refresh available via `vault.balances(chains, { refresh: true })`

### Vault Instance Caching
- Keep active vault in memory
- Cache recently accessed vaults


## Error Handling

### Error Types
```typescript
enum VaultErrorCode {
  ENCRYPTED_VAULT = 'ENCRYPTED_VAULT',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  STORAGE_ERROR = 'STORAGE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  EMAIL_VERIFICATION_REQUIRED = 'EMAIL_VERIFICATION_REQUIRED',
  KEYGEN_FAILED = 'KEYGEN_FAILED',
  SDK_NOT_INITIALIZED = 'SDK_NOT_INITIALIZED',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  SIGNING_FAILED = 'SIGNING_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  PRICE_API_ERROR = 'PRICE_API_ERROR',
  SWAP_NOT_SUPPORTED = 'SWAP_NOT_SUPPORTED'
}

class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message)
  }
}
```

### Graceful Degradation
- Failed balance requests return cached values
- Network errors don't break address derivation
- Storage errors fallback to in-memory operations