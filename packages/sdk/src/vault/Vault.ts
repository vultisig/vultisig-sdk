import { create } from '@bufbuild/protobuf'
// Core functions (functional dispatch) - Direct imports from core
import { Chain } from '@core/chain/Chain'
import type { AccountCoin } from '@core/chain/coin/AccountCoin'
import { getCoinBalance } from '@core/chain/coin/balance'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getChainSpecific } from '@core/mpc/keysign/chainSpecific'
import type { FeeSettings } from '@core/mpc/keysign/chainSpecific/FeeSettings'
import { buildSendKeysignPayload } from '@core/mpc/keysign/send/build'
import { toCommCoin } from '@core/mpc/types/utils/commCoin'
import {
  type KeysignPayload,
  KeysignPayloadSchema,
} from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'

import { formatBalance } from '../adapters/formatBalance'
import { formatGasInfo } from '../adapters/formatGasInfo'
// SDK utilities
import { DEFAULT_CHAINS, isChainSupported } from '../ChainManager'
import { UniversalEventEmitter } from '../events/EventEmitter'
import type { VaultEvents } from '../events/types'
import { CacheService } from '../services/CacheService'
import { FastSigningService } from '../services/FastSigningService'
// Types
import {
  Balance,
  GasInfo,
  Signature,
  SigningMode,
  SigningPayload,
  Token,
} from '../types'
import { VaultError, VaultErrorCode } from './VaultError'
import { VaultConfig, VaultServices } from './VaultServices'

/**
 * Determine vault type based on signer names
 * Fast vaults have one signer that starts with "Server-"
 * Secure vaults have only device signers (no "Server-" prefix)
 */
function determineVaultType(signers: string[]): 'fast' | 'secure' {
  return signers.some(signer => signer.startsWith('Server-'))
    ? 'fast'
    : 'secure'
}

/**
 * Vault class - Functional Adapter Approach
 *
 * This class provides a thin layer over core functions, handling:
 * - Caching (addresses: permanent, balances: 5-min TTL)
 * - Format conversion (bigint → Balance, FeeQuote → GasInfo)
 * - Error handling and user-friendly messages
 * - Event emission for reactive updates
 *
 * Architecture:
 * - Vault → Core Functions (direct) → Chain Resolvers
 * - Aligns with core's functional dispatch pattern
 */
export class Vault extends UniversalEventEmitter<VaultEvents> {
  // Essential services only
  private wasmManager
  private cacheService: CacheService
  private fastSigningService?: FastSigningService

  // Cached properties
  private _isEncrypted?: boolean
  private _securityType?: 'fast' | 'secure'

  // Runtime state (not persisted)
  private _userChains: Chain[] = []
  private _currency: string = 'USD'
  private _tokens: Record<string, Token[]> = {}

  constructor(
    private vaultData: CoreVault,
    services: VaultServices,
    config?: VaultConfig
  ) {
    // Initialize EventEmitter
    super()

    // Inject essential services
    this.wasmManager = services.wasmManager
    this.fastSigningService = services.fastSigningService
    this.cacheService = new CacheService()

    // Initialize user chains from config
    this._userChains = config?.defaultChains ?? DEFAULT_CHAINS

    // Initialize currency from config
    this._currency = config?.defaultCurrency ?? 'USD'
  }

  // ===== VAULT INFO =====

  /**
   * Get vault summary information
   */
  summary() {
    return {
      id: this.vaultData.publicKeys.ecdsa,
      name: this.vaultData.name,
      type: this._securityType ?? determineVaultType(this.vaultData.signers),
      chains: this.getChains(),
      createdAt: this.vaultData.createdAt,
      isBackedUp: this.vaultData.isBackedUp,
    }
  }

  /**
   * Set cached encryption status (called during import)
   */
  setCachedEncryptionStatus(isEncrypted: boolean): void {
    this._isEncrypted = isEncrypted
  }

  /**
   * Get cached encryption status
   */
  getCachedEncryptionStatus(): boolean | undefined {
    return this._isEncrypted
  }

  /**
   * Set cached security type (called during import)
   */
  setCachedSecurityType(securityType: 'fast' | 'secure'): void {
    this._securityType = securityType
  }

  /**
   * Get cached security type
   */
  getCachedSecurityType(): 'fast' | 'secure' | undefined {
    return this._securityType
  }

  /**
   * Rename vault
   */
  async rename(newName: string): Promise<void> {
    // Validate new name
    const validationResult = this.validateVaultName(newName)
    if (!validationResult.isValid) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        validationResult.errors?.[0] || 'Invalid vault name'
      )
    }

    const oldName = this.vaultData.name
    this.vaultData.name = newName

    // Emit renamed event
    this.emit('renamed', { oldName, newName })
  }

  /**
   * Validate vault name
   */
  private validateVaultName(name: string): {
    isValid: boolean
    errors?: string[]
  } {
    const errors: string[] = []

    if (!name || name.trim().length === 0) {
      errors.push('Vault name cannot be empty')
    }

    if (name.length < 2) {
      errors.push('Vault name must be at least 2 characters long')
    }

    if (name.length > 50) {
      errors.push('Vault name cannot exceed 50 characters')
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      errors.push(
        'Vault name can only contain letters, numbers, spaces, hyphens, and underscores'
      )
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Export vault data as downloadable file
   */
  async export(password?: string): Promise<Blob> {
    const { createVaultBackup, getExportFileName } = await import(
      '../utils/export'
    )

    const base64Data = await createVaultBackup(this.vaultData, password)
    const filename = getExportFileName(this.vaultData)

    const blob = new Blob([base64Data], { type: 'application/octet-stream' })

    // Automatically download if in browser
    if (
      typeof globalThis !== 'undefined' &&
      'window' in globalThis &&
      'document' in globalThis
    ) {
      const { initiateFileDownload } = await import(
        '@lib/utils/file/initiateFileDownload'
      )
      initiateFileDownload({ blob, name: filename })
    }

    return blob
  }

  /**
   * Delete vault (placeholder)
   */
  delete(): Promise<void> {
    throw new Error(
      'delete() not implemented yet - requires storage integration'
    )
  }

  // ===== ADDRESS METHODS =====

  /**
   * Get address for specified chain
   * Uses core's deriveAddress() with permanent caching
   */
  async address(chain: Chain): Promise<string> {
    const cacheKey = `address:${chain.toLowerCase()}`

    // Check permanent cache
    const cached = this.cacheService.get<string>(
      cacheKey,
      Number.MAX_SAFE_INTEGER
    )
    if (cached) return cached

    try {
      // Get WalletCore
      const walletCore = await this.wasmManager.getWalletCore()

      // Get public key using core
      const publicKey = getPublicKey({
        chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Derive address using core (handles all chain-specific logic)
      const address = deriveAddress({
        chain,
        publicKey,
        walletCore,
      })

      // Cache permanently (addresses don't change)
      this.cacheService.set(cacheKey, address)
      return address
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.AddressDerivationFailed,
        `Failed to derive address for ${chain}`,
        error as Error
      )
    }
  }

  /**
   * Get addresses for multiple chains
   */
  async addresses(chains?: Chain[]): Promise<Record<string, string>> {
    const chainsToDerive = chains || this._userChains
    const result: Record<string, string> = {}

    // Parallel derivation
    await Promise.all(
      chainsToDerive.map(async chain => {
        try {
          result[chain] = await this.address(chain)
        } catch (error) {
          console.warn(`Failed to derive address for ${chain}:`, error)
        }
      })
    )

    return result
  }

  // ===== BALANCE METHODS =====

  /**
   * Get balance for chain (with optional token)
   * Uses core's getCoinBalance() with 5-minute TTL cache
   */
  async balance(chain: Chain, tokenId?: string): Promise<Balance> {
    const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`

    // Check 5-min TTL cache
    const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)
    if (cached) return cached

    let address: string | undefined
    try {
      address = await this.address(chain)

      // Core handles balance fetching for ALL chains
      // Supports: native, ERC-20, SPL, wasm tokens automatically
      const rawBalance = await getCoinBalance({
        chain,
        address,
        id: tokenId, // Token ID (contract address for ERC-20, etc.)
      })

      // Format using adapter
      const balance = formatBalance(rawBalance, chain, tokenId, this._tokens)

      // Cache with 5-min TTL
      this.cacheService.set(cacheKey, balance)

      // Emit balance updated event
      this.emit('balanceUpdated', {
        chain,
        balance,
        tokenId,
      })

      return balance
    } catch (error) {
      // Enhanced error logging for E2E test debugging
      const errorMessage = (error as Error)?.message || 'Unknown error'
      const errorName = (error as Error)?.name || 'Error'

      this.emit('error', error as Error)
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Failed to fetch balance for ${chain}${tokenId ? `:${tokenId}` : ''}: ${errorName}: ${errorMessage}`,
        error as Error
      )
    }
  }

  /**
   * Get balances for multiple chains
   */
  async balances(
    chains?: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToFetch = chains || this._userChains
    const result: Record<string, Balance> = {}

    for (const chain of chainsToFetch) {
      try {
        // Native balance
        result[chain] = await this.balance(chain)

        // Token balances
        if (includeTokens) {
          const tokens = this._tokens[chain] || []
          for (const token of tokens) {
            result[`${chain}:${token.id}`] = await this.balance(chain, token.id)
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch balance for ${chain}:`, error)
      }
    }

    return result
  }

  /**
   * Force refresh balance (clear cache)
   */
  async updateBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`
    this.cacheService.clear(cacheKey)
    // balance() will emit the balanceUpdated event
    return this.balance(chain, tokenId)
  }

  /**
   * Force refresh multiple balances
   */
  async updateBalances(
    chains?: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToUpdate = chains || this._userChains

    // Clear cache for all chains
    for (const chain of chainsToUpdate) {
      const cacheKey = `balance:${chain}:native`
      this.cacheService.clear(cacheKey)

      if (includeTokens) {
        const tokens = this._tokens[chain] || []
        for (const token of tokens) {
          const tokenCacheKey = `balance:${chain}:${token.id}`
          this.cacheService.clear(tokenCacheKey)
        }
      }
    }

    return this.balances(chainsToUpdate, includeTokens)
  }

  // ===== GAS ESTIMATION =====

  /**
   * Well-known active addresses for Cosmos chains
   * Used for gas estimation to avoid errors when user's address doesn't exist on-chain yet
   * Gas prices are global, so any active address works for estimation
   */
  private static readonly COSMOS_GAS_ESTIMATION_ADDRESSES: Partial<
    Record<Chain, string>
  > = {
    [Chain.THORChain]: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
    [Chain.Cosmos]: 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',
    [Chain.Osmosis]: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4epasmvnj',
    [Chain.MayaChain]: 'maya1dheycdevq39qlkxs2a6wuuzyn4aqxhveshhay9',
    [Chain.Kujira]: 'kujira1nynns8ex9fq6sjjfj8k79ymkdz4sqth0hdz2q8',
    [Chain.Dydx]: 'dydx1fl48vsnmsdzcv85q5d2q4z5ajdha8yu3l3qwf0',
  }

  /**
   * Get gas info for chain
   * Uses core's getChainSpecific() to estimate fees
   */
  async gas(chain: Chain): Promise<GasInfo> {
    console.log(`🔍 Starting gas estimation for chain: ${chain}`)
    let address: string | undefined
    try {
      console.log(`  📍 Getting address...`)

      // For Cosmos chains, use well-known addresses to avoid account-doesn't-exist errors
      // Gas prices are global, so any active address works for estimation
      const cosmosAddress = Vault.COSMOS_GAS_ESTIMATION_ADDRESSES[chain]
      if (cosmosAddress) {
        address = cosmosAddress
        console.log(
          `  📍 Using well-known address for Cosmos gas estimation: ${address}`
        )
      } else {
        address = await this.address(chain)
        console.log(`  📍 Address: ${address}`)
      }

      // Get WalletCore
      const walletCore = await this.wasmManager.getWalletCore()

      // Get public key
      const publicKey = getPublicKey({
        chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Create minimal keysign payload to get fee data
      const minimalPayload = create(KeysignPayloadSchema, {
        coin: toCommCoin({
          chain,
          address,
          decimals: chainFeeCoin[chain].decimals,
          ticker: chainFeeCoin[chain].ticker,
          hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
        }),
        toAddress: address, // Dummy address for fee estimation
        toAmount: '1', // Minimal amount for fee estimation
        vaultLocalPartyId: this.vaultData.localPartyId,
        vaultPublicKeyEcdsa: this.vaultData.publicKeys.ecdsa,
        libType: this.vaultData.libType,
      })

      // Get chain-specific data with fee information
      console.log(`  ⛓️ Calling getChainSpecific()...`)
      const chainSpecific = await getChainSpecific({
        keysignPayload: minimalPayload,
        walletCore,
      })
      console.log(`  ✅ getChainSpecific() succeeded, formatting...`)

      // Format using adapter
      const result = formatGasInfo(chainSpecific, chain)
      console.log(`  ✅ formatGasInfo() succeeded`)
      return result
    } catch (error) {
      // Enhanced error logging for E2E test debugging
      const errorMessage = (error as Error)?.message || 'Unknown error'
      const errorName = (error as Error)?.name || 'Error'

      throw new VaultError(
        VaultErrorCode.GasEstimationFailed,
        `Failed to estimate gas for ${chain}: ${errorName}: ${errorMessage}`,
        error as Error
      )
    }
  }

  // ===== TRANSACTION PREPARATION =====

  /**
   * Prepare a send transaction keysign payload
   *
   * This method builds a complete keysign payload for sending tokens or native coins.
   * The returned `KeysignPayload` can be passed directly to the `sign()` method.
   *
   * @param params - Transaction parameters
   * @param params.coin - The coin to send (AccountCoin with chain, address, decimals, ticker, and optional id for tokens)
   * @param params.receiver - The recipient's address
   * @param params.amount - Amount to send in base units (as bigint)
   * @param params.memo - Optional transaction memo (for chains that support it)
   * @param params.feeSettings - Optional custom fee settings (FeeSettings - chain-specific)
   *
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * // Prepare a native coin transfer
   * const payload = await vault.prepareSendTx({
   *   coin: {
   *     chain: Chain.Ethereum,
   *     address: await vault.address('ethereum'),
   *     decimals: 18,
   *     ticker: 'ETH'
   *   },
   *   receiver: '0x...',
   *   amount: 1500000000000000000n // 1.5 ETH
   * })
   *
   * // Sign the transaction
   * const signature = await vault.sign('fast', payload, password)
   * ```
   *
   * @example
   * ```typescript
   * // Prepare a token transfer with custom fees
   * const payload = await vault.prepareSendTx({
   *   coin: {
   *     chain: Chain.Ethereum,
   *     address: await vault.address('ethereum'),
   *     decimals: 6,
   *     ticker: 'USDC',
   *     id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   *   },
   *   receiver: '0x...',
   *   amount: 100000000n, // 100 USDC
   *   feeSettings: {
   *     maxPriorityFeePerGas: 2000000000n,
   *     gasLimit: 100000n
   *   }
   * })
   * ```
   */
  async prepareSendTx(params: {
    coin: AccountCoin
    receiver: string
    amount: bigint
    memo?: string
    feeSettings?: FeeSettings
  }): Promise<KeysignPayload> {
    try {
      // Get WalletCore
      const walletCore = await this.wasmManager.getWalletCore()

      // Get public key for the coin's chain
      const publicKey = getPublicKey({
        chain: params.coin.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Build the keysign payload using core function
      const keysignPayload = await buildSendKeysignPayload({
        coin: params.coin,
        receiver: params.receiver,
        amount: params.amount,
        memo: params.memo,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        publicKey,
        walletCore,
        libType: this.vaultData.libType,
        feeSettings: params.feeSettings,
      })

      return keysignPayload
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare send transaction: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  // ===== SIGNING METHODS =====

  /**
   * Sign transaction
   */
  async sign(
    mode: SigningMode,
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    this.validateSigningMode(mode)

    switch (mode) {
      case 'fast':
        return this.signFast(payload, password)
      case 'relay':
        throw new VaultError(
          VaultErrorCode.NotImplemented,
          'Relay signing not implemented yet'
        )
      case 'local':
        throw new VaultError(
          VaultErrorCode.NotImplemented,
          'Local signing not implemented yet'
        )
      default:
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Unsupported signing mode: ${mode}`
        )
    }
  }

  /**
   * Validate signing mode against vault type
   */
  private validateSigningMode(mode: SigningMode): void {
    const securityType =
      this._securityType ?? determineVaultType(this.vaultData.signers)

    if (mode === 'fast' && securityType !== 'fast') {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Fast signing is only available for fast vaults (vaults with VultiServer)'
      )
    }

    if (mode === 'relay' && securityType !== 'secure') {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Relay signing is only available for secure vaults'
      )
    }
  }

  /**
   * Fast signing with VultiServer
   */
  private async signFast(
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    if (!password) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Password is required for fast signing'
      )
    }

    if (!this.fastSigningService) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'FastSigningService not initialized'
      )
    }

    try {
      const signature = await this.fastSigningService.signWithServer(
        this.vaultData,
        payload,
        password
      )

      // Emit transaction signed event
      this.emit('transactionSigned', { signature, payload })

      return signature
    } catch (error) {
      this.emit('error', error as Error)

      if (error instanceof VaultError) {
        throw error
      }

      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `Fast signing failed: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  // ===== TOKEN MANAGEMENT =====

  /**
   * Set tokens for a chain
   */
  setTokens(chain: Chain, tokens: Token[]): void {
    this._tokens[chain] = tokens
  }

  /**
   * Add single token to chain
   */
  addToken(chain: Chain, token: Token): void {
    if (!this._tokens[chain]) this._tokens[chain] = []
    if (!this._tokens[chain].find(t => t.id === token.id)) {
      this._tokens[chain].push(token)
      // Emit token added event
      this.emit('tokenAdded', { chain, token })
    }
  }

  /**
   * Remove token from chain
   */
  removeToken(chain: Chain, tokenId: string): void {
    if (this._tokens[chain]) {
      const tokenExists = this._tokens[chain].some(t => t.id === tokenId)
      this._tokens[chain] = this._tokens[chain].filter(t => t.id !== tokenId)

      if (tokenExists) {
        // Emit token removed event
        this.emit('tokenRemoved', { chain, tokenId })
      }
    }
  }

  /**
   * Get tokens for chain
   */
  getTokens(chain: Chain): Token[] {
    return this._tokens[chain] || []
  }

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set user chains
   */
  async setChains(chains: Chain[]): Promise<void> {
    // Validate all chains
    chains.forEach(chain => {
      if (!isChainSupported(chain)) {
        throw new VaultError(
          VaultErrorCode.ChainNotSupported,
          `Chain not supported: ${chain}`
        )
      }
    })

    this._userChains = chains

    // Pre-derive addresses
    await this.addresses(chains)
  }

  /**
   * Add single chain
   */
  async addChain(chain: Chain): Promise<void> {
    if (!isChainSupported(chain)) {
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Chain not supported: ${chain}`
      )
    }

    if (!this._userChains.includes(chain)) {
      this._userChains.push(chain)
      await this.address(chain) // Pre-derive

      // Emit chain added event
      this.emit('chainAdded', { chain })
    }
  }

  /**
   * Remove single chain
   */
  removeChain(chain: Chain): void {
    const chainExists = this._userChains.includes(chain)
    this._userChains = this._userChains.filter(c => c !== chain)

    // Clear address cache
    const cacheKey = `address:${chain.toLowerCase()}`
    this.cacheService.clear(cacheKey)

    if (chainExists) {
      // Emit chain removed event
      this.emit('chainRemoved', { chain })
    }
  }

  /**
   * Get current user chains
   */
  getChains(): Chain[] {
    return [...this._userChains]
  }

  /**
   * Reset to default chains
   */
  async resetToDefaultChains(): Promise<void> {
    this._userChains = DEFAULT_CHAINS
    await this.addresses(this._userChains)
  }

  /**
   * Get supported chains (alias for getChains)
   */
  private getSupportedChains(): Chain[] {
    return this.getChains()
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set vault currency
   */
  setCurrency(currency: string): void {
    this._currency = currency
  }

  /**
   * Get vault currency
   */
  getCurrency(): string {
    return this._currency
  }

  // ===== DATA ACCESS =====

  /**
   * Get the underlying vault data
   */
  get data(): CoreVault {
    return this.vaultData
  }
}
