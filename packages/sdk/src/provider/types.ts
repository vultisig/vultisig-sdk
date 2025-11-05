import type { Vault as VaultClass } from '../vault/Vault'
import type { VaultStorage } from './storage/types'
import type { ProviderEvents } from './events/types'
import type {
  Balance,
  Signature,
  SigningMode,
  SigningPayload,
  VaultType,
  Summary,
} from '../types'

/**
 * Configuration options for provider initialization.
 */
export interface ProviderConfig {
  /** Custom storage implementation (auto-selected if not provided) */
  storage?: VaultStorage

  /** Auto-initialize WASM modules on construction */
  autoInit?: boolean

  /** Auto-connect and load last active vault */
  autoConnect?: boolean

  /** Default chains to activate */
  defaultChains?: string[]

  /** Default currency for vault */
  defaultCurrency?: string

  /** Custom endpoint URLs */
  endpoints?: {
    fastVault?: string
    relay?: string
  }
}

/**
 * Options for connecting to a vault.
 */
export interface ConnectionOptions {
  /** Specific vault ID to load */
  vaultId?: string

  /** Password for encrypted vaults */
  password?: string
}

/**
 * Parameters for signing a transaction.
 */
export interface SignTransactionParams {
  /** Chain to sign for */
  chain: string

  /** Transaction payload (chain-specific format) */
  payload: SigningPayload

  /** Password for signing */
  password?: string

  /** Signing mode (fast, relay, local) */
  mode?: SigningMode
}

/**
 * Parameters for sending a transaction (sign + broadcast).
 */
export interface SendTransactionParams extends SignTransactionParams {
  // Inherits all SignTransactionParams
}

/**
 * Parameters for signing a message.
 */
export interface SignMessageParams {
  chain: string
  message: string
  password?: string
}

/**
 * Parameters for signing typed data (EIP-712).
 */
export interface SignTypedDataParams {
  chain: string
  typedData: Record<string, unknown>
  password?: string
}

/**
 * Parameters for fetching balance.
 */
export interface GetBalanceParams {
  chain: string
  tokenId?: string
}

/**
 * Options for creating a vault.
 */
export interface CreateVaultOptions {
  name: string
  type?: VaultType
  password?: string
  email?: string
  onProgress?: (step: VaultCreationStep) => void
}

/**
 * Vault creation progress step
 */
export interface VaultCreationStep {
  step: 'initializing' | 'keygen' | 'complete'
  progress: number
  message: string
}

/**
 * Vault summary information.
 */
export interface VaultSummary {
  id: string
  name: string
  type: VaultType
  createdAt: number
  isEncrypted: boolean
}

/**
 * Main provider interface.
 * All providers (Browser, Node, Electron) implement this interface.
 *
 * Design Philosophy:
 * - Type-safe: No `any` types, strict typing throughout
 * - Event-driven: Emit events for all state changes
 * - Error-handling: Comprehensive error taxonomy
 * - Async-first: All operations are async for consistency
 */
export interface VultisigProvider {
  // ============================================
  // Connection Management
  // ============================================

  /**
   * Connect to the provider and optionally load a vault.
   * Initializes WASM modules and loads vault from storage.
   */
  connect(options?: ConnectionOptions): Promise<void>

  /**
   * Disconnect from the provider.
   * Clears active vault but preserves stored vaults.
   */
  disconnect(): Promise<void>

  /**
   * Check if provider is connected and has an active vault.
   */
  isConnected(): boolean

  // ============================================
  // Account Management
  // ============================================

  /**
   * Get accounts for a specific chain or all chains.
   * Returns addresses controlled by the active vault.
   */
  getAccounts(chain?: string): Promise<string[]>

  /**
   * Get the active account address for a specific chain.
   */
  getActiveAccount(chain: string): Promise<string | null>

  // ============================================
  // Chain Management
  // ============================================

  /**
   * Get list of all supported chains.
   */
  getSupportedChains(): string[]

  /**
   * Set the active chain for the provider.
   */
  setActiveChain(chain: string): Promise<void>

  /**
   * Get the currently active chain.
   */
  getActiveChain(): Promise<string>

  // ============================================
  // Transaction Operations
  // ============================================

  /**
   * Sign a transaction (does not broadcast).
   */
  signTransaction(params: SignTransactionParams): Promise<Signature>

  /**
   * Sign and broadcast a transaction.
   * @returns Transaction hash
   */
  sendTransaction(params: SendTransactionParams): Promise<string>

  // ============================================
  // Message Signing
  // ============================================

  /**
   * Sign a plain text message.
   */
  signMessage(params: SignMessageParams): Promise<string>

  /**
   * Sign typed data (EIP-712 for Ethereum).
   */
  signTypedData(params: SignTypedDataParams): Promise<string>

  // ============================================
  // Balance Queries
  // ============================================

  /**
   * Get balance for a specific chain/token.
   */
  getBalance(params: GetBalanceParams): Promise<Balance>

  /**
   * Get balances for multiple chains.
   */
  getBalances(chains?: string[]): Promise<Record<string, Balance>>

  // ============================================
  // Vault Management
  // ============================================

  /**
   * Create a new vault.
   */
  createVault(options: CreateVaultOptions): Promise<VaultClass>

  /**
   * Import a vault from file or buffer.
   */
  importVault(file: File | Buffer, password?: string): Promise<VaultClass>

  /**
   * List all available vaults.
   */
  listVaults(): Promise<VaultSummary[]>

  /**
   * Switch to a different vault.
   */
  switchVault(vaultId: string): Promise<void>

  /**
   * Delete a vault from storage.
   */
  deleteVault(vaultId: string): Promise<void>

  /**
   * Get the currently active vault instance.
   */
  getActiveVault(): VaultClass | null

  // ============================================
  // Event Handling
  // ============================================

  /**
   * Register an event listener.
   */
  on<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): () => void

  /**
   * Register a one-time event listener.
   */
  once<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): () => void

  /**
   * Unregister an event listener.
   */
  off<K extends keyof ProviderEvents>(
    event: K,
    handler: (data: ProviderEvents[K]) => void
  ): void
}
