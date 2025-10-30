import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance, Signature, SigningPayload } from '../../types'
import { parseSolanaTransaction } from './parsers/transaction'
import { buildSolanaKeysignPayload } from './keysign'
import { ParsedSolanaTransaction } from './types'
import { Chain } from '@core/chain/Chain'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getCoinBalance } from '@core/chain/coin/balance'
import { WASMManager } from '../../wasm/WASMManager'

/**
 * Strategy implementation for Solana.
 * Wraps all Solana-specific utilities and provides unified interface.
 */
export class SolanaStrategy implements ChainStrategy {
  readonly chainId = 'Solana'
  private readonly wasmManager: WASMManager

  constructor(wasmManager: WASMManager) {
    this.wasmManager = wasmManager
  }

  /**
   * Derive Solana address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Get Ed25519 public key (Solana uses Ed25519, not ECDSA, derivation path determined by chain)
    const publicKey = getPublicKey({
      chain: Chain.Solana,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: Chain.Solana,
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for Solana address
   * TODO(Phase 2): BalanceService will handle Blockchair integration and type conversion
   */
  async getBalance(address: string): Promise<Balance> {
    // Simple wrapper - BalanceService will improve this in Phase 2
    const rawBalance = await getCoinBalance({
      chain: Chain.Solana,
      address
    })

    // TODO(Phase 2): Proper type conversion in BalanceService
    return {
      amount: rawBalance.toString(),
      decimals: 9, // SOL has 9 decimals
      symbol: 'SOL'
    }
  }

  /**
   * Parse Solana transaction (base64 or Buffer)
   * TODO(Phase 2): Fix type compatibility with parseSolanaTransaction
   */
  async parseTransaction(rawTx: string | Buffer): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    // TODO(Phase 2): parseSolanaTransaction expects Uint8Array, handle conversion
    const parsed = await parseSolanaTransaction(walletCore, rawTx as any)
    return parsed as ParsedTransaction
  }

  /**
   * Build keysign payload for Solana transaction
   * TODO(Phase 2): Align return types properly
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const solanaTx = tx as ParsedSolanaTransaction

    // Build Solana-specific keysign payload
    const payload = await buildSolanaKeysignPayload({
      parsedTransaction: solanaTx,
      serializedTransaction: (solanaTx as any).serializedTransaction || new Uint8Array(),
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast ?? false
    })

    // TODO(Phase 2): Remove type assertion when interfaces are aligned
    return payload as any
  }

  /**
   * Compute pre-signing hashes for Fast Vault signing
   * TODO(Phase 6): Implement Solana transaction message hashing for fast vault
   */
  async computePreSigningHashes(
    _payload: SigningPayload,
    _vault: any,
    _walletCore: any
  ): Promise<string[]> {
    // TODO(Phase 6): Implement Solana transaction message hashing
    // Solana signing is typically done on the transaction message directly
    throw new Error('Solana fast vault signing not yet implemented - will be added in Phase 6')
  }

  /**
   * Format signature results from MPC keysign
   * Solana uses Ed25519 signatures
   */
  async formatSignatureResult(
    signatureResults: Record<string, any>,
    _payload: SigningPayload
  ): Promise<Signature> {
    // Solana uses Ed25519 signatures
    const messageHash = Object.keys(signatureResults)[0]
    const sigResult = signatureResults[messageHash]

    return {
      signature: sigResult.der_signature || sigResult.signature,
      format: 'Ed25519',
    }
  }

  /**
   * Solana doesn't have gas estimation in the same way as EVM
   * Transaction fees are deterministic
   */
  // estimateGas is not implemented (optional in interface)

  /**
   * Get WalletCore instance via injected WASMManager
   */
  private async getWalletCore(): Promise<WalletCore> {
    return this.wasmManager.getWalletCore()
  }
}
