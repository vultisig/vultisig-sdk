import type { 
  Vault,
  VaultOptions,
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
  ExportOptions,
  ChainKind,
  Balance,
  SigningPayload,
  Signature,
  ReshareOptions,
  ServerStatus,
  KeygenProgressUpdate
} from './types'

import { Chain } from '@core/chain/Chain'

import { VaultManager } from './vault'
import { MPCManager } from './mpc'
import { ChainManager } from './chains'
import { AddressDeriver } from './chains/AddressDeriver'
import { ServerManager } from './server'
import { WASMManager } from './wasm'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 * 
 * Features:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support  
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 * - Auto-initialization and simplified API
 */
export class Vultisig {
  private vaultManager: VaultManager
  private mpcManager: MPCManager
  private chainManager: ChainManager
  private addressDeriver: AddressDeriver
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false
  private vaults = new Map<string, any>()
  private activeVault: any = null
  private defaultChains: string[] = ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
  private defaultCurrency = 'USD'

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
  }) {
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this.vaultManager = new VaultManager()
    this.mpcManager = new MPCManager(this.serverManager)
    this.chainManager = new ChainManager(this.wasmManager)
    this.addressDeriver = new AddressDeriver()
    
    // Apply config defaults
    if (config?.defaultChains) {
      this.defaultChains = config.defaultChains
    }
    if (config?.defaultCurrency) {
      this.defaultCurrency = config.defaultCurrency
    }
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
   * Automatically initializes VaultManager with this SDK instance
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return
    
    try {
      // Initialize WASM directly like the working version
      await this.wasmManager.initialize()
      const walletCore = await this.wasmManager.getWalletCore()
      
      // Initialize the AddressDeriver with WalletCore
      await this.addressDeriver.initialize(walletCore)
      
      // Auto-initialize VaultManager with this SDK instance
      VaultManager.init(this, {
        defaultChains: this.defaultChains,
        defaultCurrency: this.defaultCurrency
      })
      
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

  // ===== VAULT LIFECYCLE =====

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
  ): Promise<any> {
    await this.ensureInitialized()
    
    // Use VaultManager to create the vault
    const vault = await VaultManager.create(name, options)
    
    // Store and set as active
    const vaultId = vault.data?.publicKeys?.ecdsa || vault.summary().id
    this.vaults.set(vaultId, vault)
    this.activeVault = vault
    
    return vault
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<any> {
    await this.ensureInitialized()
    
    // Use VaultManager to add the vault
    const vault = await VaultManager.add(file, password)
    
    // Store and set as active
    const vaultId = vault.data?.publicKeys?.ecdsa || vault.summary().id
    this.vaults.set(vaultId, vault)
    this.activeVault = vault
    
    return vault
  }

  /**
   * List all stored vaults
   */
  async listVaults(): Promise<any[]> {
    await this.ensureInitialized()
    return VaultManager.list()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: any): Promise<void> {
    await this.ensureInitialized()
    
    const vaultId = vault.data?.publicKeys?.ecdsa || vault.summary().id
    
    // Remove from VaultManager
    await VaultManager.remove(vault)
    
    // Remove from our local storage
    this.vaults.delete(vaultId)
    
    // Clear active vault if it was the deleted one
    if (this.activeVault === vault) {
      this.activeVault = null
    }
  }


  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await VaultManager.clear()
    this.vaults.clear()
    this.activeVault = null
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  setActiveVault(vault: any): void {
    this.activeVault = vault
    const vaultId = vault.data?.publicKeys?.ecdsa || vault.summary().id
    this.vaults.set(vaultId, vault)
  }

  /**
   * Get current active vault
   */
  getActiveVault(): any | null {
    return this.activeVault
  }

  /**
   * Check if there's an active vault
   */
  hasActiveVault(): boolean {
    return this.activeVault !== null
  }

  // ===== GLOBAL CONFIGURATION =====

  /**
   * Set global default currency
   */
  setDefaultCurrency(currency: string): void {
    this.defaultCurrency = currency
    if (this.initialized) {
      VaultManager.setDefaultCurrency(currency)
    }
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.defaultCurrency
  }

  // ===== CHAIN OPERATIONS =====

  /**
   * Get all hardcoded supported chains (immutable)
   * Complete list from core/chain/Chain.ts - cannot be overridden at runtime
   */
  getSupportedChains(): string[] {
    return [
      // EVM Chains
      'Ethereum', 'Arbitrum', 'Base', 'Blast', 'Optimism', 'Zksync', 'Mantle',
      'Avalanche', 'CronosChain', 'BSC', 'Polygon',
      
      // UTXO Chains  
      'Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash',
      
      // Cosmos Chains
      'THORChain', 'MayaChain', 'Cosmos', 'Osmosis', 'Dydx', 'Kujira', 
      'Terra', 'TerraClassic', 'Noble', 'Akash',
      
      // Other Chains
      'Sui', 'Solana', 'Polkadot', 'Ton', 'Ripple', 'Tron', 'Cardano'
    ]
  }

  /**
   * Set SDK-level default chains for new vaults
   * Validates against supported chains list
   */
  setDefaultChains(chains: string[]): void {
    const supportedChains = this.getSupportedChains()
    const invalidChains = chains.filter(chain => !supportedChains.includes(chain))
    
    if (invalidChains.length > 0) {
      throw new Error(`Unsupported chains: ${invalidChains.join(', ')}. Supported chains: ${supportedChains.join(', ')}`)
    }
    
    this.defaultChains = chains
    if (this.initialized) {
      VaultManager.setDefaultChains(chains)
    }
  }

  /**
   * Get SDK-level default chains (5 top chains: BTC, ETH, SOL, THOR, XRP)
   */
  getDefaultChains(): string[] {
    return this.defaultChains
  }

  // ===== FILE OPERATIONS =====

  /**
   * Check if .vult file is encrypted
   */
  async isVaultFileEncrypted(file: File): Promise<boolean> {
    return VaultManager.isEncrypted(file)
  }

  // ===== SERVER-BASED OPERATIONS =====

  /**
   * Create a Fast Vault where VultiServer acts as the second device
   * This is the most convenient method for single-device usage
   */
  async createFastVault(options: { name: string; email: string; password: string; onLog?: (message: string) => void; onProgress?: (u: KeygenProgressUpdate) => void }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: boolean
  }> {
    await this.ensureInitialized()
    return this.serverManager.createFastVault(options)
  }

  /**
   * Verify vault with email verification code
   * @param vaultId The ECDSA public key that serves as the vault identifier
   * @param code Email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    return this.serverManager.verifyVault(vaultId, code)
  }

  /**
   * Verify vault email (alias for verifyVault for compatibility)
   */
  async verifyVaultEmail(vaultId: string, code: string): Promise<boolean> {
    return this.verifyVault(vaultId, code)
  }

  /**
   * Get verified vault from server after email verification
   * @param vaultId The ECDSA public key that serves as the vault identifier
   * @param password Vault decryption password
   */
  async getVault(vaultId: string, password: string): Promise<Vault> {
    return this.serverManager.getVerifiedVault(vaultId, password)
  }

  /**
   * Resend vault verification email
   */
  async resendVaultVerification(vaultId: string): Promise<void> {
    return this.serverManager.resendVaultVerification(vaultId)
  }

  /**
   * Get vault from VultiServer using password
   * @param vaultId The ECDSA public key that serves as the vault identifier
   * @param password Vault decryption password
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault> {
    return this.serverManager.getVaultFromServer(vaultId, password)
  }

  /**
   * Sign transaction using VultiServer
   */
  async signWithServer(vault: Vault, payload: SigningPayload): Promise<Signature> {
    return this.serverManager.signWithServer(vault, payload)
  }

  /**
   * Reshare vault participants
   */
  async reshareVault(vault: Vault, reshareOptions: ReshareOptions): Promise<Vault> {
    return this.serverManager.reshareVault(vault, reshareOptions)
  }

  // ===== Server status and health =====

  /**
   * Check VultiServer status and connectivity
   */
  async checkServerStatus(): Promise<ServerStatus> {
    return this.serverManager.checkServerStatus()
  }

  // ===== Relay session helpers =====
  async startRelaySession(params: { serverUrl: string; sessionId: string; devices: string[] }): Promise<void> {
    return this.serverManager.startRelaySession(params)
  }

  async joinRelaySession(params: { serverUrl: string; sessionId: string; localPartyId: string }): Promise<void> {
    return this.serverManager.joinRelaySession(params)
  }

  async getRelayPeerOptions(params: { serverUrl: string; sessionId: string; localPartyId: string }): Promise<string[]> {
    return this.serverManager.getRelayPeerOptions(params)
  }

  // ===== FastVault helpers =====
  async createFastVaultOnServer(params: {
    name: string
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    encryptionPassword: string
    email: string
    libType: number
  }): Promise<void> {
    return this.serverManager.createFastVaultOnServer(params)
  }

  /**
   * Get server status (alias for checkServerStatus)
   */
  async getServerStatus(): Promise<ServerStatus> {
    return this.checkServerStatus()
  }

  // ===== Vault handling operations (wrapping existing core/lib code) =====


  /**
   * Export vault to backup format
   */
  async exportVault(vault: Vault, options?: ExportOptions): Promise<VaultBackup> {
    return this.vaultManager.exportVault(vault, options)
  }

  /**
   * Import vault from backup
   */
  async importVault(backup: VaultBackup, password?: string): Promise<Vault> {
    return this.vaultManager.importVault(backup, password)
  }

  /**
   * Import vault from file (ArrayBuffer or File)
   */
  async importVaultFromFile(fileData: ArrayBuffer | File, password?: string): Promise<Vault> {
    return this.vaultManager.importVaultFromFile(fileData, password)
  }

  /**
   * Get vault details and metadata
   */
  getVaultDetails(vault: Vault): VaultDetails {
    return this.vaultManager.getVaultDetails(vault)
  }

  /**
   * Validate vault structure and integrity
   */
  validateVault(vault: Vault): VaultValidationResult {
    return this.vaultManager.validateVault(vault)
  }

  // ===== Chain operations =====

  /**
   * Get addresses for vault across specific chains
   */
  async getAddresses(vault: Vault, chains: Chain[]): Promise<Record<Chain, string>> {
    return this.chainManager.getAddresses(vault, chains)
  }

  /**
   * Get addresses for vault across chain kinds (categories)
   */
  async getAddressesByKind(vault: Vault, chainKinds: ChainKind[]): Promise<Record<ChainKind, string>> {
    return this.chainManager.getAddressesByKind(vault, chainKinds)
  }

  /**
   * Get balances for addresses across specific chains
   */
  async getBalances(addresses: Record<Chain, string>): Promise<Record<Chain, Balance>> {
    return this.chainManager.getBalances(addresses)
  }

  /**
   * Get balances for chain kinds
   */
  async getBalancesByKind(addresses: Record<ChainKind, string>): Promise<Record<ChainKind, Balance>> {
    return this.chainManager.getBalancesByKind(addresses)
  }

  /**
   * Get balances for a vault across common chains
   */
  async getVaultBalances(vault: Vault): Promise<Record<string, Balance>> {
    await this.ensureInitialized()
    
    // Define common chains to check
    const commonChains = ['bitcoin', 'ethereum', 'thorchain', 'litecoin']
    
    try {
      // Get addresses for the vault using AddressDeriver
      const addresses = await this.addressDeriver.deriveMultipleAddresses(vault, commonChains)
      
      // Get balances for each address (mock implementation for now)
      const result: Record<string, Balance> = {}
      for (const [chain, address] of Object.entries(addresses)) {
        // For now, return zero balances - balance fetching can be implemented later
        result[chain] = {
          amount: '0',
          decimals: 8,
          symbol: chain.toUpperCase()
        }
      }
      
      return result
    } catch (error) {
      throw new Error(`Failed to get vault balances: ${error}`)
    }
  }

  /**
   * Derive address for a vault on a specific chain
   */
  async deriveAddress(vault: Vault, chain: string): Promise<string> {
    await this.ensureInitialized()
    return this.addressDeriver.deriveAddress(vault, chain)
  }

  /**
   * Get chain client for specific blockchain
   */
  getChainClient(chain: Chain) {
    return this.chainManager.getChainClient(chain)
  }
}