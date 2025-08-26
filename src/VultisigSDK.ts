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
 * Main VultisigSDK class providing secure multi-party computation and blockchain operations
 * 
 * Features:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support  
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 */
export class VultisigSDK {
  private vaultManager: VaultManager
  private mpcManager: MPCManager
  private chainManager: ChainManager
  private addressDeriver: AddressDeriver
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false

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
  }) {
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this.vaultManager = new VaultManager()
    this.mpcManager = new MPCManager(this.serverManager)
    this.chainManager = new ChainManager(this.wasmManager)
    this.addressDeriver = new AddressDeriver()
  }

  /**
   * Initialize the SDK and load WASM modules
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    
    try {
      // Initialize WASM directly like the working version
      await this.wasmManager.initialize()
      const walletCore = await this.wasmManager.getWalletCore()
      
      // Initialize the AddressDeriver with WalletCore
      await this.addressDeriver.initialize(walletCore)
      
      this.initialized = true
    } catch (error) {
      throw new Error('Failed to initialize SDK: ' + (error as Error).message)
    }
  }

  /**
   * Check if SDK is initialized
   */
  async isInitialized(): Promise<boolean> {
    return this.initialized
  }

  // ===== VultiServer-based operations =====

  /**
   * Create a new vault using multi-device MPC (requires multiple devices)
   */
  async createVault(options: VaultOptions): Promise<Vault> {
    return this.vaultManager.createVault(options)
  }

  /**
   * Create a Fast Vault where VultiServer acts as the second device
   * This is the most convenient method for single-device usage
   */
  async createFastVault(options: { name: string; email: string; password: string; onLog?: (message: string) => void; onProgress?: (u: KeygenProgressUpdate) => void }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: boolean
  }> {
    await this.initialize()
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
   * Check if vault keyshares are encrypted
   */
  isVaultEncrypted(vault: Vault): boolean {
    return this.vaultManager.isVaultEncrypted(vault)
  }

  /**
   * Encrypt vault keyshares with passcode
   */
  async encryptVault(vault: Vault, passcode: string): Promise<Vault> {
    return this.vaultManager.encryptVault(vault, passcode)
  }

  /**
   * Decrypt vault keyshares with passcode
   */
  async decryptVault(vault: Vault, passcode: string): Promise<Vault> {
    return this.vaultManager.decryptVault(vault, passcode)
  }

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
   * Check if a vault file is encrypted
   */
  async isVaultFileEncrypted(file: File): Promise<boolean> {
    return this.vaultManager.isVaultFileEncrypted(file)
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
    await this.initialize()
    
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
    await this.initialize()
    return this.addressDeriver.deriveAddress(vault, chain)
  }

  /**
   * Get chain client for specific blockchain
   */
  getChainClient(chain: Chain) {
    return this.chainManager.getChainClient(chain)
  }
}