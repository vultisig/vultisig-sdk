// Types from corrected VAULTPLAN.md

export type VaultType = 'fast' | 'secure'
export type KeygenMode = 'fast' | 'relay' | 'local'
export type SigningMode = 'fast' | 'relay' | 'local'

export interface SDKConfig {
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

  // VaultManager configuration
  vaultManagerConfig?: VaultManagerConfig
}

export interface VaultManagerConfig {
  defaultChains: string[]                   // Global default chains for all vaults
  defaultCurrency: string                   // Global default currency for all vaults
}

export interface ServerStatus {
  vultiServer: 'online' | 'offline'         // Fast vault server status
  messageRelay: 'online' | 'offline'        // Message relay server status
  lastChecked: number                       // Timestamp of last status check
}

export interface ValidationResult {
  isValid: boolean                          // Whether validation passed
  errors?: string[]                         // Specific validation errors (if any)
}

export interface VaultCreationStep {
  step: 'initializing' | 'keygen' | 'deriving_addresses' | 'fetching_balances' | 'applying_tokens' | 'complete'
  progress: number                          // Progress percentage (0-100)
  message: string                          // Human readable status message
  chainId?: string                         // Current chain being processed (if applicable)
}

export interface SigningStep {
  step: 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
  progress: number                          // Progress percentage (0-100)
  message: string                          // Human readable status message
  mode: SigningMode                        // Current signing mode being used
  participantCount?: number                // Number of participants (for relay/local modes)
  participantsReady?: number               // Number of participants ready to sign
}

export interface AddressBookEntry {
  chain: string                // Chain identifier (e.g., "ethereum", "bitcoin")
  address: string              // The actual address
  name: string                 // Human readable name
  source: 'saved' | 'vault'    // Whether manually saved or from user's other vaults
  vaultId?: string            // If source is 'vault', which vault it belongs to
  vaultName?: string          // If source is 'vault', the vault's name
  dateAdded: number           // Timestamp when added
}

export interface AddressBook {
  saved: AddressBookEntry[]    // Manually saved addresses
  vaults: AddressBookEntry[]   // Addresses from user's other vaults
}

export interface VaultSigner {
  id: string                    // Signer identifier
  publicKey: string            // Signer's public key
  name?: string                // Optional display name
}

export interface Config {
  chains: string[]                    // Chains active
  tokens: Record<string, Token[]>     // Tokens per chain
}

export interface Summary {
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
  keys: {                     // Public keys
    ecdsa: string
    eddsa: string
    hexChainCode: string
    hexEncryptionKey: string
  }
}

export interface Balance {
  amount: string              // Balance amount
  symbol: string             // Token/coin symbol
  decimals: number           // Decimal places
  chainId: string            // Chain identifier
  tokenId?: string           // Token ID (if applicable)
}

export interface SigningPayload {
  transaction: any            // Transaction data
  chain: string              // Chain identifier
  signingMode?: SigningMode   // Signing mode (defaults to vault type)
  onProgress?: (step: SigningStep) => void  // Progress callback
}

export interface Signature {
  signature: string          // Hex signature
  txHash?: string           // Transaction hash (if broadcasted)
}

export interface GasInfo {
  chainId: string           // Chain identifier
  gasPrice: string          // Current gas price (in chain's units)
  gasPriceGwei?: string     // Gas price in Gwei (for EVM chains)
  priorityFee?: string      // Priority fee (for EVM EIP-1559)
  maxFeePerGas?: string     // Max fee per gas (for EVM EIP-1559)
  lastUpdated: number       // Timestamp of gas price data
}

export interface GasEstimate {
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

export interface Token {
  id: string                    // Unique token identifier
  symbol: string               // Token symbol (e.g., "USDC", "ETH")
  name: string                 // Human readable name
  decimals: number             // Token decimals
  contractAddress?: string     // Contract address (for ERC20, etc.)
  chainId: string              // Which chain this token belongs to
  logoUrl?: string             // Token logo URL
  isNative?: boolean           // Whether this is the chain's native token
}

export interface Value {
  amount: string              // Fiat amount (e.g., "1234.56")
  currency: string           // Currency code (e.g., "USD", "EUR")
  symbol: string             // Currency symbol (e.g., "$", "€")
  rate: number              // Exchange rate used
  lastUpdated: number       // Timestamp of rate
}

export enum VaultErrorCode {
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

export class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message)
  }
}
