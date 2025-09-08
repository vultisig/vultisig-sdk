# Vultisig SDK - Simplified Architecture

## Executive Summary

VultisigSDK is a clean, vault-centric architecture with two primary classes:

- **`Vultisig`** - Main SDK class with auto-initialization
- **`Vault`** - Individual vault instance
- **`.vult`** - Vault file format (Protocol Buffers with optional AES-256-GCM encryption)

### Minimal Integration Example

```typescript
// 1. Import and create Vultisig instance
import { Vultisig } from 'vultisig-sdk'
const vultisig = new Vultisig()

// 2. Create vault with progress updates (auto-initializes SDK, sets as active)
const vault = await vultisig.createVault('My Vault', {
  password: 'password',
  email: 'user@example.com',
  onProgress: (step) => {
    console.log(`${step.step}: ${step.progress}% - ${step.message}`)
  }
})
await vault.verifyEmail('1234')

// 3. Get address/balance for transaction (vault is automatically active)
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
// 1. Create secure vault with multi-device setup (automatically sets as active)
const vault = await vultisig.createVault('My Secure Vault', {
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

## Vultisig Class
The main SDK class that provides a unified interface for all vault operations. Auto-initializes on first vault operation and manages global SDK state internally.

```typescript
class Vultisig {
  // === PRIVATE PROPERTIES ===
  private initialized: boolean = false
  private vaults: Map<string, Vault> = new Map()
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private config: VultisigConfig
  private defaultChains: string[] = []
  private defaultCurrency: string = 'USD'

  constructor(config?: VultisigConfig) {
    this.config = { ...defaultConfig, ...config }
  }

  // === AUTO-INITIALIZATION ===
  private async ensureInitialized(): Promise<void>           // Internal auto-initialization helper
  isInitialized(): boolean                                    // Check if SDK is initialized

  // === VAULT LIFECYCLE ===
  async createVault(
    name: string, 
    options?: CreateVaultOptions
  ): Promise<Vault>                                           // Create new vault (auto-initializes SDK, sets as active)

  async addVault(file: File, password?: string): Promise<Vault>  // Import vault from file (sets as active)
  async listVaults(): Promise<VaultSummary[]>                 // List all stored vaults
  async deleteVault(vault: Vault): Promise<void>              // Delete vault from storage (clears active if needed)
  async clearVaults(): Promise<void>                          // Clear all stored vaults
  
  // === ACTIVE VAULT MANAGEMENT ===
  setActiveVault(vault: Vault): void                          // Switch to different vault
  getActiveVault(): Vault | null                              // Get current active vault
  hasActiveVault(): boolean                                   // Check if there's an active vault

  // === GLOBAL CONFIGURATION ===
  setDefaultCurrency(currency: string): void                  // Set global default currency
  getDefaultCurrency(): string                                // Get global default currency
  updateConfig(config: Partial<VultisigConfig>): void         // Update SDK configuration
  getConfig(): VultisigConfig                                 // Get current configuration

  // === CHAIN OPERATIONS ===
  getSupportedChains(): string[]                              // Get all hardcoded supported chains (immutable)
  setDefaultChains(chains: string[]): void                    // Set SDK-level default chains for new vaults
  getDefaultChains(): string[]                                // Get SDK-level default chains
  
  // === VALIDATION HELPERS ===
  static validateEmail(email: string): ValidationResult       // Validate email format
  static validatePassword(password: string): ValidationResult // Validate password strength
  static validateVaultName(name: string): ValidationResult    // Validate vault name
  
  // === FILE OPERATIONS ===
  async isVaultFileEncrypted(file: File): Promise<boolean>     // Check if .vult file is encrypted
  
  // === SERVER STATUS ===
  async getServerStatus(): Promise<ServerStatus>              // Check server connectivity
  async getStatus(): Promise<VultisigStatus>                  // Get overall SDK status

  // === ADDRESS BOOK (GLOBAL) ===
  async getAddressBook(chain?: string): Promise<AddressBook>
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void>
  async removeAddressBookEntry(addresses: Array<{chain: string, address: string}>): Promise<void>
  async updateAddressBookEntry(chain: string, address: string, name: string): Promise<void>

  // === PRIVATE METHODS ===
  private async initialize(): Promise<void>                   // Internal initialization
  private configureProviders(): void                         // Set up RPC endpoints, APIs
  private applyGlobalSettings(vault: Vault): void            // Apply global settings to vault
}
```
### Vultisig Interfaces

```typescript
interface VultisigConfig {
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
  
  // Default settings
  defaultChains?: string[]                  // Default chains for new vaults
  defaultCurrency?: string                  // Default fiat currency
}

interface CreateVaultOptions {
  type?: VaultType                          // Vault type (default: 'fast')
  keygenMode?: KeygenMode                   // Keygen mode for secure vaults only (default: 'relay')
  password?: string                         // Vault encryption password
  email?: string                           // Email for fast vault verification
  onProgress?: (step: VaultCreationStep) => void  // Progress callback
}

interface ServerStatus {
  vultiServer: 'online' | 'offline'        // Fast vault server status
  messageRelay: 'online' | 'offline'       // Message relay server status
  lastChecked: number                       // Timestamp of last status check
}

interface VultisigStatus {
  initialized: boolean                      // Whether SDK is initialized
  vaultCount: number                        // Number of stored vaults
  serverStatus: ServerStatus                // Server connectivity status
  wasmLoaded: boolean                       // Whether WASM modules are loaded
}

interface ValidationResult {
  isValid: boolean                          // Whether validation passed
  errors?: string[]                         // Specific validation errors (if any)
}

interface VaultSummary {
  id: string                               // Vault ID (ECDSA public key)
  name: string                             // Display name
  isEncrypted: boolean                     // Whether vault is encrypted
  createdAt: number                        // Timestamp added to storage
  lastModified: number                     // Last modification timestamp
  size: number                             // Estimated size in bytes
  type: VaultType                          // Vault security type (derived from signers/threshold)
  threshold: number                        // Minimum signers required
  totalSigners: number                     // Total participants
  vaultIndex: number                       // Which vault share this device owns
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
  async rename(newName: string): Promise<void>    // Rename vault

  // === USER CHAIN MANAGEMENT ===
  setChains(chains: string[]): Promise<void>      // Set user chains (triggers address/balance updates)
  addChain(chain: string): Promise<void>          // Add single chain (triggers address/balance updates)
  removeChain(chain: string): Promise<void>       // Remove single chain
  getChains(): string[]                           // Get current user chains
  resetToDefaultChains(): Promise<void>           // Reset to Vultisig default chains

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
type KeygenMode = 'relay' | 'local'
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
  id: string                          // Vault ID (ECDSA public key)
  name: string                        // Display name
  isEncrypted: boolean                // Whether vault is encrypted
  createdAt: number                   // Timestamp added to storage
  lastModified: number                // Last modification timestamp
  size: number                        // Estimated size in bytes
  type: VaultType                     // Vault security type (derived from signers/threshold)
  threshold: number                   // Minimum signers required
  totalSigners: number                // Total participants
  vaultIndex: number                  // Which vault share this device owns
  signers: VaultSigner[]              // All participant details
  isBackedUp(): boolean               // Check if vault has been backed up
  keys: {                             // Public keys (from .vult file)
    ecdsa: string                     // ECDSA public key
    eddsa: string                     // EdDSA public key
    hexChainCode: string              // BIP32 chain code
    hexEncryptionKey: string          // Encryption key
  }
  // Runtime properties (not in .vult file)
  currency?: string                   // Current fiat currency preference
  chains?: string[]                   // Currently active chains
  tokens?: Record<string, Token[]>    // Tokens per chain
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

## .vult File Format

Vultisig keyshare files (`.vult`) use a layered approach with base64 encoding and Protocol Buffers serialization to store multi-party computation (MPC) threshold signature keyshares.

**Important**: `.vult` files contain only cryptographic key material and vault metadata. They do NOT contain:
- Chain configurations
- Token lists  
- Balance data
- Currency preferences
- Address caches

These runtime properties are managed by the SDK and applied when vaults are loaded.

### File Structure

```
.vult file
├── Base64 encoding (outer layer)
└── VaultContainer (protobuf)
    ├── version: uint64
    ├── is_encrypted: bool  
    └── vault: string
        ├── Base64 encoding (if unencrypted)
        ├── OR AES-256-GCM encryption (if encrypted)
        └── Vault (protobuf)
            ├── name: string
            ├── public_key_ecdsa: string (hex)
            ├── public_key_eddsa: string (hex)
            ├── signers: []string
            ├── created_at: timestamp
            ├── hex_chain_code: string (hex)
            ├── key_shares: []KeyShare
            ├── local_party_id: string
            ├── reshare_prefix: string
            └── lib_type: LibType
```

### Protocol Buffer Definitions

```protobuf
message VaultContainer {
  uint64 version = 1;           // Data format version number
  string vault = 2;             // Base64-encoded or encrypted vault data
  bool is_encrypted = 3;        // Whether vault data is password-encrypted
}

message Vault {
  string name = 1;                              // Human-readable vault name
  string public_key_ecdsa = 2;                  // Hex-encoded compressed secp256k1 public key
  string public_key_eddsa = 3;                  // Hex-encoded Ed25519 public key
  repeated string signers = 4;                  // MPC participant identifiers
  google.protobuf.Timestamp created_at = 5;     // Vault creation time
  string hex_chain_code = 6;                    // BIP32 chain code for HD derivation
  repeated KeyShare key_shares = 7;             // MPC threshold signature shares
  string local_party_id = 8;                    // Local participant ID
  string reshare_prefix = 9;                    // Prefix for key resharing
  vultisig.keygen.v1.LibType lib_type = 10;     // MPC library type (GG20 = 0)
}

message KeyShare {
  string public_key = 1;        // Public key for this share
  string keyshare = 2;          // The actual key share data
}
```

### Field Details

| Field | Type | Description |
|-------|------|-------------|
| `version` | uint64 | Data format version number |
| `is_encrypted` | bool | Whether vault data is password-encrypted |
| `vault` | string | Base64-encoded or encrypted vault data |
| `name` | string | Human-readable vault name |
| `public_key_ecdsa` | string | Hex-encoded compressed secp256k1 public key (66 chars) |
| `public_key_eddsa` | string | Hex-encoded Ed25519 public key (64 chars) |
| `signers` | []string | MPC participant identifiers |
| `created_at` | timestamp | Vault creation time |
| `hex_chain_code` | string | BIP32 chain code for HD derivation (64 chars) |
| `key_shares` | []KeyShare | MPC threshold signature shares |
| `local_party_id` | string | Local participant ID |
| `reshare_prefix` | string | Prefix for key resharing |
| `lib_type` | LibType | MPC library type (GG20 = 0) |

### Encryption

When `is_encrypted = true`, the vault data uses:

- **Algorithm**: AES-256-GCM
- **Key Derivation**: SHA256(password) 
- **Nonce**: First 12 bytes of encrypted data
- **Ciphertext**: Remaining bytes after nonce

### File Operations

```typescript
// Import vault from .vult file
const vault = await vultisig.addVault(file, password)

// Export vault to .vult file
const vaultBlob = await vault.export(password)

// Check if file is encrypted
const isEncrypted = await vultisig.isVaultFileEncrypted(file)
```

### Inspection

Use the built-in inspector to analyze vault files:

```bash
# Inspect unencrypted vault
npx tsx scripts/inspect_keyshare.ts vault.vult

# Inspect encrypted vault  
npx tsx scripts/inspect_keyshare.ts vault.vult mypassword123
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


## Chain Management Hierarchy

### **1. Supported Chains (SDK Level - Immutable)**
- **Purpose**: All chains that Vultisig can technically support
- **Scope**: Hardcoded in SDK, updated only with SDK releases
- **Access**: `vultisig.getSupportedChains()`
- **Cannot be overridden at runtime**

### **2. Default Chains (SDK Level - Configurable)**
- **Purpose**: SDK-wide default "nice to have" list (~5-6 common chains)
- **Scope**: Can be updated by developers at runtime
- **Access**: `vultisig.setDefaultChains()` / `vultisig.getDefaultChains()`
- **Examples**: `['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon']`

### **3. User Chains (Vault Level - Dynamic)**
- **Purpose**: Chains actively used by a specific vault
- **Scope**: Set when vault is created/imported, can be updated anytime
- **Access**: `vault.setChains()` / `vault.getChains()`
- **Triggers**: Address derivation, balance fetching, gas estimation

### Auto-Population Behavior
When a new vault is created:
1. **User Chains**: Inherit from `vultisig.getDefaultChains()`
2. **Addresses**: Derive addresses for all user chains and cache them
3. **Balances**: Fetch initial balances and cache
4. **Currency**: Set vault currency to `vultisig.getDefaultCurrency()`
5. **Default Tokens**: Add popular tokens for each user chain

When a vault is imported from file:
1. **User Chains**: Inherit from `vultisig.getDefaultChains()` (no chain data in .vult file)
2. **Update Currency**: Set vault currency to Vultisig's default currency
3. **Derive Addresses**: Derive addresses for all user chains
4. **Refresh Balances**: Optionally refresh balances for all user chains

### Chain Update Triggers
When `vault.setChains()`, `vault.addChain()`, or `vault.removeChain()` is called:
1. **Address Derivation**: Automatically derive addresses for new chains
2. **Balance Updates**: Fetch balances for new chains
3. **Gas Estimation**: Update gas price data for new chains
4. **Token Population**: Add default tokens for new chains

### Usage Examples

```typescript
// 1. Check what chains are supported by the SDK
const supportedChains = vultisig.getSupportedChains()
console.log(supportedChains) // ['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon', 'avalanche', ...]

// 2. Set SDK-wide default chains for new vaults
vultisig.setDefaultChains(['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon'])

// 3. Create vault - inherits default chains (automatically set as active)
const vault = await vultisig.createVault('My Wallet')
console.log(vault.getChains()) // ['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon']
console.log(vultisig.getActiveVault() === vault) // true

// 4. Add a chain to specific vault (triggers address/balance updates)
await vault.addChain('avalanche')
console.log(vault.getChains()) // ['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon', 'avalanche']

// 5. Set completely different chains for vault
await vault.setChains(['bitcoin', 'litecoin', 'dogecoin'])
console.log(vault.getChains()) // ['bitcoin', 'litecoin', 'dogecoin']

// 6. Reset vault to SDK defaults
await vault.resetToDefaultChains()
console.log(vault.getChains()) // ['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon']

// 7. Import vault inherits SDK default chains (automatically set as active)
const importedVault = await vultisig.addVault(file, password)
console.log(importedVault.getChains()) // ['bitcoin', 'ethereum', 'thorchain', 'solana', 'polygon']
console.log(vultisig.getActiveVault() === importedVault) // true

// 8. Switch between multiple vaults
const anotherVault = await vultisig.createVault('Second Wallet')
console.log(vultisig.getActiveVault() === anotherVault) // true (newest is active)

vultisig.setActiveVault(importedVault) // Switch back to imported vault
console.log(vultisig.getActiveVault() === importedVault) // true

// 9. Delete a vault (clears active if needed)
await vultisig.deleteVault(anotherVault)
console.log(vultisig.getActiveVault() === importedVault) // true (switched back)
```

### Chain Validation

```typescript
// Validate chain is supported before adding
const chain = 'ethereum'
if (vultisig.getSupportedChains().includes(chain)) {
  await vault.addChain(chain)
} else {
  throw new Error(`Chain ${chain} not supported`)
}
```


## Caching Strategy

### Address Caching (Permanent)
- Cache addresses per vault instance
- Never re-derive same chain for same vault
- Clear cache only when vault changes

### Balance Caching (TTL: 5 minutes)
- Cache balances with timestamp
- Automatic refresh after TTL expires
- Manual refresh available via `vault.updateBalances(chains, includeTokens)`

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