import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { Balance, Signature, SigningPayload } from '../../types'

/**
 * Common interface for chain-specific operations.
 * Each chain (EVM, Solana, Bitcoin, etc.) implements this interface.
 */
export interface ChainStrategy {
  /**
   * The chain identifier (e.g., 'Ethereum', 'Solana')
   */
  readonly chainId: string

  /**
   * Derive address for a vault on this chain
   */
  deriveAddress(vault: CoreVault): Promise<string>

  /**
   * Get balance for an address on this chain
   * Note: BalanceService will handle Blockchair integration
   * @param address The address to check
   */
  getBalance(address: string): Promise<Balance>

  /**
   * Parse a raw transaction for this chain
   * @param rawTx Raw transaction data (format varies by chain)
   */
  parseTransaction(rawTx: any): Promise<ParsedTransaction>

  /**
   * Build keysign payload for MPC signing
   * @param tx Parsed transaction
   * @param vaultPublicKey Vault's public key
   * @param options Additional options
   */
  buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload>

  /**
   * Estimate gas for a transaction (if applicable)
   * Optional - not all chains support gas estimation
   */
  estimateGas?(tx: any): Promise<GasEstimate>

  /**
   * Compute pre-signing hashes for MPC signing (Fast Vault support)
   * Used by FastSigningService to prepare message hashes before server coordination
   * @param payload Signing payload containing transaction data
   * @param vault Vault data with keys and configuration
   * @param walletCore WalletCore instance for cryptographic operations
   * @returns Array of hex-encoded message hashes to sign
   */
  computePreSigningHashes(
    payload: SigningPayload,
    vault: any,
    walletCore: any
  ): Promise<string[]>

  /**
   * Format signature results from MPC keysign (Fast Vault support)
   * Handles chain-specific result formatting (e.g., UTXO transaction compilation)
   * @param signatureResults Map of message hash to signature result
   * @param payload Original signing payload
   * @returns Formatted signature ready for broadcast
   */
  formatSignatureResult(
    signatureResults: Record<string, any>,
    payload: SigningPayload
  ): Promise<Signature>
}

/**
 * Generic parsed transaction type
 * Chain-specific implementations can extend this
 */
export interface ParsedTransaction {
  type: string
  from?: string
  to?: string
  value?: string | bigint
  data?: string
  chainId?: string | number
  [key: string]: any  // Allow chain-specific fields
}

/**
 * Keysign payload for MPC operations
 */
export interface KeysignPayload {
  vaultPublicKey: string
  transaction: string
  chain: string
  skipBroadcast?: boolean
  [key: string]: any
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  [key: string]: any
}

/**
 * Options for keysign payload building
 */
export interface KeysignOptions {
  skipBroadcast?: boolean
  [key: string]: any
}
