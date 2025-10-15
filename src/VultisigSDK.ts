import { ServerManager } from './server'
import type {
  AddressBook,
  AddressBookEntry,
  BroadcastOptions,
  ServerStatus,
  Signature,
  SignedTransaction,
  SigningPayload,
  TransactionReceipt,
  ValidationResult,
} from './types'
import { AddressBookManager } from './vault/AddressBook'
import { ChainManagement } from './vault/ChainManagement'
import { ValidationHelpers } from './vault/utils/validation'
import { Vault as VaultClass } from './vault/Vault'
import { VaultManagement } from './vault/VaultManagement'
import { WASMManager } from './wasm'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 */
export class Vultisig {
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false
  private rpcEndpoints?: Record<string, string>

  // Module managers
  private addressBookManager: AddressBookManager
  private chainManagement: ChainManagement
  private vaultManagement: VaultManagement

  constructor(config?: {
    serverEndpoints?: {
      fastVault?: string
      messageRelay?: string
    }
    wasmConfig?: {
      autoInit?: boolean
      wasmPaths?: {
        walletCore?: string
        dkls?: string
        schnorr?: string
      }
    }
    defaultChains?: string[]
    defaultCurrency?: string
    rpcEndpoints?: Record<string, string>
  }) {
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this.rpcEndpoints = config?.rpcEndpoints

    // Initialize module managers
    this.addressBookManager = new AddressBookManager()
    this.chainManagement = new ChainManagement({
      defaultChains: config?.defaultChains,
      defaultCurrency: config?.defaultCurrency,
    })
    this.vaultManagement = new VaultManagement(this.wasmManager, this)
  }

  /**
   * Internal auto-initialization helper
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * Initialize the SDK and load WASM modules
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.wasmManager.initialize()
      this.initialized = true
    } catch (error) {
      throw new Error('Failed to initialize SDK: ' + (error as Error).message)
    }
  }

  /**
   * Check if SDK is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  // === VAULT LIFECYCLE ===

  /**
   * Create new vault (auto-initializes SDK, sets as active)
   */
  async createVault(
    name: string,
    options?: {
      type?: 'fast' | 'secure'
      keygenMode?: 'relay' | 'local'
      password?: string
      email?: string
      onProgress?: (step: any) => void
    }
  ): Promise<VaultClass> {
    await this.ensureInitialized()
    return this.vaultManagement.createVault(name, options)
  }

  /**
   * Create fast vault (convenience method)
   * Equivalent to createVault(name, { type: 'fast', ...options })
   */
  async createFastVault(options: {
    name: string
    password: string
    email: string
    onProgress?: (step: any) => void
  }): Promise<{
    vault: VaultClass
    vaultId: string
    verificationRequired: boolean
  }> {
    await this.ensureInitialized()
    const vault = await this.vaultManagement.createVault(options.name, {
      type: 'fast',
      password: options.password,
      email: options.email,
      onProgress: options.onProgress,
    })

    return {
      vault,
      vaultId: vault.data.publicKeys.ecdsa,
      verificationRequired: true,
    }
  }

  /**
   * Verify fast vault with email code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.serverManager.verifyVault(vaultId, code)
  }

  /**
   * Get vault from VultiServer
   */
  async getVault(vaultId: string, password: string): Promise<VaultClass> {
    await this.ensureInitialized()
    const vaultData = await this.serverManager.getVaultFromServer(
      vaultId,
      password
    )

    // Create VaultClass instance
    const vault = new VaultClass(
      vaultData,
      await this.wasmManager.getWalletCore(),
      this.wasmManager,
      this
    )

    // Store the vault and set as active
    this.vaultManagement.setActiveVault(vault)

    return vault
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<VaultClass> {
    await this.ensureInitialized()
    return this.vaultManagement.addVault(file, password)
  }

  /**
   * List all stored vaults
   */
  async listVaults(): Promise<any[]> {
    await this.ensureInitialized()
    return this.vaultManagement.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultClass): Promise<void> {
    await this.ensureInitialized()
    return this.vaultManagement.deleteVault(vault)
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await this.vaultManagement.clearVaults()
    this.addressBookManager.clear()
  }

  // === ACTIVE VAULT MANAGEMENT ===

  /**
   * Switch to different vault
   */
  setActiveVault(vault: VaultClass): void {
    this.vaultManagement.setActiveVault(vault)
  }

  /**
   * Get current active vault
   */
  getActiveVault(): VaultClass | null {
    return this.vaultManagement.getActiveVault()
  }

  /**
   * Check if there's an active vault
   */
  hasActiveVault(): boolean {
    return this.vaultManagement.hasActiveVault()
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  setDefaultCurrency(currency: string): void {
    this.chainManagement.setDefaultCurrency(currency)
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.chainManagement.getDefaultCurrency()
  }

  // === CHAIN OPERATIONS ===

  /**
   * Get all hardcoded supported chains (immutable)
   */
  getSupportedChains(): string[] {
    return this.chainManagement.getSupportedChains()
  }

  /**
   * Set SDK-level default chains for new vaults
   */
  setDefaultChains(chains: string[]): void {
    this.chainManagement.setDefaultChains(chains)
  }

  /**
   * Get SDK-level default chains
   */
  getDefaultChains(): string[] {
    return this.chainManagement.getDefaultChains()
  }

  // === VALIDATION HELPERS ===

  /**
   * Validate email format
   */
  static validateEmail(email: string): ValidationResult {
    return ValidationHelpers.validateEmail(email)
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): ValidationResult {
    return ValidationHelpers.validatePassword(password)
  }

  /**
   * Validate vault name
   */
  static validateVaultName(name: string): ValidationResult {
    return ValidationHelpers.validateVaultName(name)
  }

  // === FILE OPERATIONS ===

  /**
   * Check if .vult file is encrypted
   */
  async isVaultFileEncrypted(file: File): Promise<boolean> {
    return this.vaultManagement.isVaultFileEncrypted(file)
  }

  // === SERVER STATUS ===

  /**
   * Check server connectivity
   */
  async getServerStatus(): Promise<ServerStatus> {
    return this.serverManager.checkServerStatus()
  }

  // === ADDRESS BOOK (GLOBAL) ===

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: string): Promise<AddressBook> {
    return this.addressBookManager.getAddressBook(chain)
  }

  /**
   * Add address book entries
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    return this.addressBookManager.addAddressBookEntry(entries)
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(
    addresses: Array<{ chain: string; address: string }>
  ): Promise<void> {
    return this.addressBookManager.removeAddressBookEntry(addresses)
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: string,
    address: string,
    name: string
  ): Promise<void> {
    return this.addressBookManager.updateAddressBookEntry(chain, address, name)
  }

  // === SIGNING OPERATIONS ===

  /**
   * Sign transaction with the active vault using fast signing mode
   * Only works with fast vaults (vaults with VultiServer)
   */
  async signTransaction(
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    await this.ensureInitialized()
    const activeVault = this.getActiveVault()
    if (!activeVault) {
      throw new Error('No active vault. Please set an active vault first.')
    }
    return activeVault.sign('fast', payload, password)
  }

  /**
   * Sign transaction with a specific vault using fast signing mode
   */
  async signTransactionWithVault(
    vault: VaultClass,
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    await this.ensureInitialized()
    return vault.sign('fast', payload, password)
  }

  /**
   * Broadcast a signed transaction to the blockchain
   */
  async broadcastTransaction(
    chain: string,
    signedTransaction: SignedTransaction,
    options?: BroadcastOptions
  ): Promise<TransactionReceipt> {
    await this.ensureInitialized()

    if (!signedTransaction.compiled) {
      throw new Error('Transaction must be compiled before broadcasting')
    }

    // Use the existing broadcast resolver
    const { broadcastTx } = await import('./core/chain/tx/broadcast')
    const { getChainKind } = await import('./core/chain/ChainKind')
    const { AddressDeriver } = await import('./chains/AddressDeriver')

    // Map string chain to Chain enum
    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(await this.wasmManager.getWalletCore())
    const chainEnum = addressDeriver.mapStringToChain(chain)

    try {
      // For broadcasting, we need to pass the decoded signing output, not the raw encoded data
      // The encoded field contains the Uint8Array, but broadcastTx expects SigningOutput
      // We'll need to reconstruct this from the compiled data
      const { decodeSigningOutput } = await import(
        './core/chain/tw/signingOutput'
      )

      // The encoded field should be the compiled transaction data
      const signingOutput = decodeSigningOutput(
        chainEnum,
        signedTransaction.compiled.encoded
      )

      // Broadcast the transaction
      await broadcastTx({
        chain: chainEnum,
        tx: signingOutput,
      })

      // Generate explorer URL
      const explorerUrl = this.generateExplorerUrl(
        chain,
        signedTransaction.compiled.hash
      )

      return {
        hash: signedTransaction.compiled.hash,
        status: 'pending',
        explorerUrl,
      }
    } catch (error) {
      console.error('Failed to broadcast transaction:', error)
      throw new Error(
        `Failed to broadcast transaction: ${(error as Error).message}`
      )
    }
  }

  /**
   * Sign and broadcast transaction in one call
   */
  async signAndBroadcast(
    payload: SigningPayload,
    password: string,
    options?: BroadcastOptions
  ): Promise<TransactionReceipt> {
    await this.ensureInitialized()

    const activeVault = this.getActiveVault()
    if (!activeVault) {
      throw new Error('No active vault. Please set an active vault first.')
    }

    // Sign the transaction
    const signature = await activeVault.sign('fast', payload, password)

    if (!signature.compiled) {
      throw new Error('Transaction compilation failed during signing')
    }

    // Create signed transaction object
    const signedTransaction: SignedTransaction = {
      signature: signature.signature,
      compiled: signature.compiled,
      chain: payload.chain,
      format: signature.format,
      recovery: signature.recovery,
    }

    // Broadcast the transaction
    return this.broadcastTransaction(payload.chain, signedTransaction, options)
  }

  /**
   * Generate explorer URL for a transaction hash
   */
  private generateExplorerUrl(chain: string, hash: string): string {
    const chainLower = chain.toLowerCase()

    // Common explorer patterns
    const explorers: Record<string, string> = {
      ethereum: `https://etherscan.io/tx/${hash}`,
      bitcoin: `https://blockstream.info/tx/${hash}`,
      solana: `https://solscan.io/tx/${hash}`,
      polygon: `https://polygonscan.com/tx/${hash}`,
      arbitrum: `https://arbiscan.io/tx/${hash}`,
      optimism: `https://optimistic.etherscan.io/tx/${hash}`,
      base: `https://basescan.org/tx/${hash}`,
      avalanche: `https://snowtrace.io/tx/${hash}`,
      bsc: `https://bscscan.com/tx/${hash}`,
    }

    return (
      explorers[chainLower] || `https://explorer.${chainLower}.com/tx/${hash}`
    )
  }

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }

  /**
   * Get RPC endpoint for a specific chain
   */
  getRpcEndpoint(chain: string): string | undefined {
    return this.rpcEndpoints?.[chain]
  }

  // === HELPER UTILITIES ===

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(
    chain: string,
    transaction: {
      to: string
      value?: string
      data?: string
      from?: string
    }
  ): Promise<{
    gasLimit: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
  }> {
    await this.ensureInitialized()

    const { GasEstimator } = await import('./chains/helpers')
    const { AddressDeriver } = await import('./chains/AddressDeriver')

    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(await this.wasmManager.getWalletCore())

    const gasEstimator = new GasEstimator(addressDeriver)
    return gasEstimator.estimateGas(chain, transaction)
  }

  /**
   * Get nonce for an address
   */
  async getNonce(chain: string, address: string): Promise<number> {
    await this.ensureInitialized()

    const { NonceManager } = await import('./chains/helpers')
    const { AddressDeriver } = await import('./chains/AddressDeriver')

    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(await this.wasmManager.getWalletCore())

    const nonceManager = new NonceManager(addressDeriver)
    return nonceManager.getNonce(chain, address)
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(
    chain: string,
    hash: string,
    options: {
      confirmations?: number
      timeout?: number
    } = {}
  ): Promise<TransactionReceipt> {
    await this.ensureInitialized()

    const { TransactionWaiter } = await import('./chains/helpers')
    const { AddressDeriver } = await import('./chains/AddressDeriver')

    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(await this.wasmManager.getWalletCore())

    const transactionWaiter = new TransactionWaiter(addressDeriver)
    return transactionWaiter.waitForTransaction(chain, hash, options)
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(
    chain: string,
    hash: string
  ): Promise<TransactionReceipt> {
    await this.ensureInitialized()

    const { TransactionWaiter } = await import('./chains/helpers')
    const { AddressDeriver } = await import('./chains/AddressDeriver')

    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(await this.wasmManager.getWalletCore())

    const transactionWaiter = new TransactionWaiter(addressDeriver)
    return transactionWaiter.getTransactionStatus(chain, hash)
  }
}
