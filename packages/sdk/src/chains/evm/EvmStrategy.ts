import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  GasEstimate,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance, Signature, SigningPayload } from '../../types'
import { parseEvmTransaction } from './parsers/transaction'
import { buildEvmKeysignPayload } from './keysign'
import { estimateTransactionGas } from './gas/estimation'
import { ParsedEvmTransaction } from './types'
import { EvmChain } from '@core/chain/Chain'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getCoinBalance } from '@core/chain/coin/balance'

/**
 * Strategy implementation for EVM-compatible chains.
 * Wraps all EVM-specific utilities and provides unified interface.
 */
export class EvmStrategy implements ChainStrategy {
  readonly chainId: string
  private readonly evmChain: EvmChain

  constructor(chainId: string) {
    this.chainId = chainId
    this.evmChain = chainId as EvmChain
  }

  /**
   * Derive Ethereum address for vault
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    // Get wallet core instance
    const walletCore = await this.getWalletCore()

    // Get ECDSA public key (derivation path determined by chain)
    const publicKey = getPublicKey({
      chain: this.evmChain,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: this.evmChain,
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for Ethereum address
   * TODO(Phase 2): BalanceService will handle Blockchair integration and type conversion
   */
  async getBalance(address: string): Promise<Balance> {
    // Simple wrapper - BalanceService will improve this in Phase 2
    const rawBalance = await getCoinBalance({
      chain: this.evmChain,
      address
    })

    // TODO(Phase 2): Proper type conversion in BalanceService
    return {
      amount: rawBalance.toString(),
      decimals: 18,
      symbol: this.chainId
    }
  }

  /**
   * Parse EVM transaction (RLP-encoded)
   */
  async parseTransaction(rawTx: string | Uint8Array): Promise<ParsedTransaction> {
    const walletCore = await this.getWalletCore()
    const parsed = await parseEvmTransaction(walletCore, rawTx)
    return parsed as ParsedTransaction
  }

  /**
   * Build keysign payload for EVM transaction
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const evmTx = tx as ParsedEvmTransaction

    // Build EVM-specific keysign payload
    const payload = await buildEvmKeysignPayload({
      parsedTransaction: evmTx,
      rawTransaction: (evmTx as any).rawTransaction || '',
      vaultPublicKey,
      skipBroadcast: options?.skipBroadcast ?? false
    })

    return payload
  }

  /**
   * Estimate gas for EVM transaction
   * TODO(Phase 2): Handle legacy gasPrice for non-EIP1559 chains
   */
  async estimateGas(tx: any): Promise<GasEstimate> {
    const estimate = await estimateTransactionGas(this.evmChain, {
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value ?? 0n
    })

    return {
      gasLimit: estimate.gasLimit,
      maxFeePerGas: estimate.maxFeePerGas,
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
      // TODO(Phase 2): EvmGasEstimate doesn't have gasPrice - handle legacy chains
      gasPrice: estimate.maxFeePerGas // Use maxFeePerGas as fallback for now
    }
  }

  /**
   * Compute pre-signing hashes for Fast Vault signing
   * Moved from ServerManager.computeMessageHashesFromTransaction
   */
  async computePreSigningHashes(
    payload: SigningPayload,
    vault: any,
    walletCore: any
  ): Promise<string[]> {
    // Import viem for transaction serialization and hashing
    const { serializeTransaction, keccak256 } = await import('viem')

    const tx = payload.transaction

    // Build EIP-1559 transaction for signing
    const unsigned = {
      type: 'eip1559' as const,
      chainId: tx.chainId,
      to: tx.to as `0x${string}`,
      nonce: tx.nonce,
      gas: BigInt(tx.gasLimit),
      data: (tx.data || '0x') as `0x${string}`,
      value: BigInt(tx.value),
      maxFeePerGas: BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? '0'),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas ?? '0'),
      accessList: [],
    }

    // Serialize transaction and compute keccak256 hash
    const serialized = serializeTransaction(unsigned)
    const signingHash = keccak256(serialized).slice(2)  // Remove '0x' prefix

    // EVM chains use a single signing hash
    return [signingHash]
  }

  /**
   * Format signature results from MPC keysign
   * EVM uses single-message signing with recovery ID
   */
  async formatSignatureResult(
    signatureResults: Record<string, any>,
    payload: SigningPayload
  ): Promise<Signature> {
    // EVM chains use single message
    const messageHash = Object.keys(signatureResults)[0]
    const sigResult = signatureResults[messageHash]

    // Extract recovery ID if present (for ECDSA)
    const recoveryId = sigResult.recovery_id
      ? parseInt(sigResult.recovery_id, 16)
      : undefined

    return {
      signature: sigResult.der_signature,
      format: recoveryId !== undefined ? 'ECDSA' : 'DER',
      recovery: recoveryId,
    }
  }

  /**
   * Get WalletCore instance
   * In real implementation, this should be injected via constructor or context
   */
  private async getWalletCore(): Promise<WalletCore> {
    const { getWalletCore } = require('../../wasm/WASMManager')
    return getWalletCore()
  }
}
