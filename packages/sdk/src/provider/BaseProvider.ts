import { Vultisig } from '../VultisigSDK'
import { Vault as VaultClass } from '../vault/Vault'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { ProviderEvents } from './events/types'
import type {
  VultisigProvider,
  ProviderConfig,
  ConnectionOptions,
  SignTransactionParams,
  SendTransactionParams,
  SignMessageParams,
  SignTypedDataParams,
  GetBalanceParams,
  CreateVaultOptions,
  VaultSummary,
} from './types'
import type { VaultStorage } from './storage/types'
import { MemoryStorage } from './storage/MemoryStorage'
import type { Balance, Signature, Summary } from '../types'
import { Chain } from '@core/chain/Chain'

/**
 * Base provider implementation.
 * Environment-specific providers extend this class.
 *
 * Design Philosophy:
 * - Delegates ALL operations to existing SDK infrastructure
 * - Adds persistence layer via VaultStorage
 * - Emits events for reactive UI updates
 * - Type-safe throughout
 *
 * What BaseProvider Does:
 * - Connection state management
 * - Vault persistence (save/load from storage)
 * - Event emission for state changes
 * - Consistent error handling
 *
 * What BaseProvider Does NOT Do:
 * - Chain operations (delegated to Core via Vault)
 * - MPC protocols (delegated to Core via Vault)
 * - Transaction building (delegated to Core)
 */
export abstract class BaseProvider
  extends UniversalEventEmitter<ProviderEvents>
  implements VultisigProvider
{
  protected sdk: Vultisig
  protected storage: VaultStorage
  protected connected = false
  protected activeChain: string = Chain.Ethereum

  constructor(config: ProviderConfig = {}) {
    super()

    // Use provided storage or default to memory
    this.storage = config.storage ?? new MemoryStorage()

    // Create SDK instance
    this.sdk = new Vultisig({
      serverEndpoints: config.endpoints,
      defaultChains: config.defaultChains,
      defaultCurrency: config.defaultCurrency,
    })

    // Auto-initialize if requested
    if (config.autoInit) {
      this.sdk.initialize().catch(err => this.emit('error', err))
    }

    // Auto-connect if requested
    if (config.autoConnect) {
      this.connect().catch(err => this.emit('error', err))
    }
  }

  // ============================================
  // Connection Management
  // ============================================

  async connect(options?: ConnectionOptions): Promise<void> {
    try {
      // Initialize WASM modules
      await this.sdk.initialize()

      if (options?.vaultId) {
        // Load specific vault
        await this.loadVaultFromStorage(options.vaultId, options.password)
      } else {
        // Auto-load last active vault
        await this.loadLastActiveVault()
      }

      this.connected = true
      this.emit('connect', undefined)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.sdk.setActiveVault(null as any) // Clear active vault
    this.connected = false
    this.emit('disconnect', undefined)
  }

  isConnected(): boolean {
    return this.connected && this.sdk.hasActiveVault()
  }

  /**
   * Load vault from storage by ID
   */
  private async loadVaultFromStorage(
    vaultId: string,
    password?: string
  ): Promise<void> {
    const vaultData = await this.storage.get<Summary>(`vault:${vaultId}`)
    if (!vaultData) {
      throw new Error(`Vault not found: ${vaultId}`)
    }

    // Reconstruct File-like object for SDK
    // SDK expects a File with .vult extension
    const blob = new Blob([JSON.stringify(vaultData)], {
      type: 'application/json',
    })
    const file = new File([blob], `${vaultData.name}.vult`)

    // Import vault using SDK
    const vault = await this.sdk.addVault(file, password)

    // Emit event
    this.emit('vaultChanged', { vaultId })
  }

  /**
   * Load last active vault from storage
   */
  private async loadLastActiveVault(): Promise<void> {
    const lastVaultId = await this.storage.get<string>('activeVaultId')
    if (lastVaultId) {
      try {
        await this.loadVaultFromStorage(lastVaultId)
      } catch (error) {
        console.warn('Failed to load last active vault:', error)
        // Don't throw - continue with no active vault
      }
    }
  }

  /**
   * Save vault to storage
   */
  private async saveVaultToStorage(vault: VaultClass): Promise<void> {
    const summary = vault.summary()
    const vaultId = summary.id

    // Store vault summary
    await this.storage.set(`vault:${vaultId}`, summary)

    // Store as last active
    await this.storage.set('activeVaultId', vaultId)
  }

  // ============================================
  // Account Management
  // ============================================

  async getAccounts(chain?: string): Promise<string[]> {
    const vault = this.sdk.getActiveVault()
    if (!vault) return []

    try {
      if (chain) {
        const address = await vault.address(chain)
        return address ? [address] : []
      }

      // Get addresses for all active chains
      const chains = vault.getChains()
      const addresses = await vault.addresses(chains)
      return Object.values(addresses).filter(Boolean) as string[]
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async getActiveAccount(chain: string): Promise<string | null> {
    const vault = this.sdk.getActiveVault()
    if (!vault) return null

    try {
      return await vault.address(chain)
    } catch (error) {
      this.emit('error', error as Error)
      return null
    }
  }

  // ============================================
  // Chain Management
  // ============================================

  getSupportedChains(): string[] {
    return this.sdk.getSupportedChains()
  }

  async setActiveChain(chain: string): Promise<void> {
    this.activeChain = chain
    await this.storage.set('activeChain', chain)
    this.emit('chainChanged', { chain })
  }

  async getActiveChain(): Promise<string> {
    // Try to get from storage first
    const stored = await this.storage.get<string>('activeChain')
    return stored ?? this.activeChain
  }

  // ============================================
  // Transaction Operations
  // ============================================

  async signTransaction(params: SignTransactionParams): Promise<Signature> {
    const vault = this.sdk.getActiveVault()
    if (!vault) {
      throw new Error('No active vault. Please connect first.')
    }

    try {
      const mode = params.mode ?? 'fast'
      return await vault.sign(mode, params.payload, params.password)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async sendTransaction(params: SendTransactionParams): Promise<string> {
    try {
      // Sign transaction
      const signature = await this.signTransaction(params)

      // TODO: Broadcasting requires proper transaction building with SigningOutput
      // For now, users should use the Core's broadcastTx directly with proper transaction format
      // This is a complex operation that requires chain-specific transaction serialization
      throw new Error(
        'sendTransaction not fully implemented yet. ' +
        'Please use signTransaction() and broadcast manually using Core\'s broadcastTx() ' +
        'with proper SigningOutput format.'
      )
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Message Signing
  // ============================================

  async signMessage(params: SignMessageParams): Promise<string> {
    const vault = this.sdk.getActiveVault()
    if (!vault) {
      throw new Error('No active vault. Please connect first.')
    }

    try {
      const signature = await vault.sign(
        'local',
        {
          transaction: { type: 'message', message: params.message },
          chain: params.chain,
        },
        params.password
      )

      return signature.signature
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async signTypedData(params: SignTypedDataParams): Promise<string> {
    const vault = this.sdk.getActiveVault()
    if (!vault) {
      throw new Error('No active vault. Please connect first.')
    }

    try {
      const signature = await vault.sign(
        'local',
        {
          transaction: { type: 'typedData', data: params.typedData },
          chain: params.chain,
        },
        params.password
      )

      return signature.signature
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Balance Queries
  // ============================================

  async getBalance(params: GetBalanceParams): Promise<Balance> {
    const vault = this.sdk.getActiveVault()
    if (!vault) {
      throw new Error('No active vault. Please connect first.')
    }

    try {
      const balance = await vault.balance(params.chain, params.tokenId)

      // Emit event for reactive updates
      this.emit('balanceUpdated', { chain: params.chain, balance })

      return balance
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async getBalances(chains?: string[]): Promise<Record<string, Balance>> {
    const vault = this.sdk.getActiveVault()
    if (!vault) return {}

    try {
      const targetChains = chains ?? vault.getChains()
      return await vault.balances(targetChains)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ============================================
  // Vault Management
  // ============================================

  async createVault(options: CreateVaultOptions): Promise<VaultClass> {
    try {
      // Create vault using SDK
      const vault = await this.sdk.createVault(options.name, {
        type: options.type,
        password: options.password,
        email: options.email,
        onProgress: options.onProgress,
      })

      // Save to storage
      await this.saveVaultToStorage(vault)

      // Emit event
      const vaultId = vault.data.publicKeys.ecdsa
      this.emit('vaultChanged', { vaultId })

      return vault
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async importVault(
    file: File | Buffer,
    password?: string
  ): Promise<VaultClass> {
    try {
      // Import vault using SDK
      const vault = await this.sdk.addVault(file as File, password)

      // Save to storage
      await this.saveVaultToStorage(vault)

      // Emit event
      const vaultId = vault.data.publicKeys.ecdsa
      this.emit('vaultChanged', { vaultId })

      return vault
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async listVaults(): Promise<VaultSummary[]> {
    try {
      const keys = await this.storage.list()
      const summaries: VaultSummary[] = []

      for (const key of keys) {
        // Only process vault keys
        if (!key.startsWith('vault:')) continue

        const summary = await this.storage.get<Summary>(key)
        if (summary) {
          summaries.push({
            id: summary.id,
            name: summary.name,
            type: summary.type,
            createdAt: summary.createdAt,
            isEncrypted: summary.isEncrypted,
          })
        }
      }

      return summaries
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async switchVault(vaultId: string): Promise<void> {
    try {
      await this.loadVaultFromStorage(vaultId)
      this.emit('vaultChanged', { vaultId })
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  async deleteVault(vaultId: string): Promise<void> {
    try {
      await this.storage.remove(`vault:${vaultId}`)

      // Clear active vault if it was deleted
      const activeVault = this.sdk.getActiveVault()
      if (activeVault?.data.publicKeys.ecdsa === vaultId) {
        this.sdk.setActiveVault(null as any)
        await this.storage.remove('activeVaultId')
        this.emit('vaultChanged', { vaultId: '' })
      }
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  getActiveVault(): VaultClass | null {
    return this.sdk.getActiveVault()
  }
}
