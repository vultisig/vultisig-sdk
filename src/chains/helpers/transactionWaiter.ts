import { EvmChain } from '../../core/chain/Chain'
import { getEvmClient } from '../../core/chain/chains/evm/client'
import type { TransactionReceipt } from '../../types'
import { AddressDeriver } from '../AddressDeriver'

/**
 * Transaction waiting and status checking utilities
 */
export class TransactionWaiter {
  private addressDeriver: AddressDeriver

  constructor(addressDeriver: AddressDeriver) {
    this.addressDeriver = addressDeriver
  }

  /**
   * Wait for EVM transaction confirmation
   */
  async waitForEvmTransaction(
    chain: string,
    hash: string,
    options: {
      confirmations?: number
      timeout?: number
    } = {}
  ): Promise<TransactionReceipt> {
    const { confirmations = 1, timeout = 60000 } = options

    try {
      const chainEnum = this.addressDeriver.mapStringToChain(chain) as EvmChain
      const client = getEvmClient(chainEnum)

      // Wait for transaction receipt
      const receipt = await client.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        confirmations,
        timeout,
      })

      return {
        hash,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        blockNumber: Number(receipt.blockNumber),
        confirmations: (receipt as any).confirmations,
        gasUsed: receipt.gasUsed.toString(),
      }
    } catch (error) {
      console.error('Failed to wait for EVM transaction:', error)

      // Check if transaction exists
      try {
        const chainEnum = this.addressDeriver.mapStringToChain(
          chain
        ) as EvmChain
        const client = getEvmClient(chainEnum)
        const tx = await client.getTransaction({ hash: hash as `0x${string}` })

        if (tx) {
          return {
            hash,
            status: 'pending',
          }
        }
      } catch {
        // Transaction not found
      }

      throw new Error(`Transaction wait failed: ${(error as Error).message}`)
    }
  }

  /**
   * Get transaction status for EVM chains
   */
  async getEvmTransactionStatus(
    chain: string,
    hash: string
  ): Promise<TransactionReceipt> {
    try {
      const chainEnum = this.addressDeriver.mapStringToChain(chain) as EvmChain
      const client = getEvmClient(chainEnum)

      // Try to get transaction receipt first
      try {
        const receipt = await client.getTransactionReceipt({
          hash: hash as `0x${string}`,
        })

        return {
          hash,
          status: receipt.status === 'success' ? 'confirmed' : 'failed',
          blockNumber: Number(receipt.blockNumber),
          confirmations: (receipt as any).confirmations,
          gasUsed: receipt.gasUsed.toString(),
        }
      } catch {
        // No receipt yet, check if transaction exists
        const tx = await client.getTransaction({ hash: hash as `0x${string}` })

        if (tx) {
          return {
            hash,
            status: 'pending',
          }
        }
      }

      // Transaction not found
      return {
        hash,
        status: 'failed',
      }
    } catch (error) {
      console.error('Failed to get EVM transaction status:', error)
      return {
        hash,
        status: 'failed',
      }
    }
  }

  /**
   * Wait for transaction confirmation on any supported chain
   */
  async waitForTransaction(
    chain: string,
    hash: string,
    options: {
      confirmations?: number
      timeout?: number
    } = {}
  ): Promise<TransactionReceipt> {
    const chainLower = chain.toLowerCase()

    // Route to chain-specific waiters
    if (
      [
        'ethereum',
        'polygon',
        'arbitrum',
        'optimism',
        'base',
        'avalanche',
        'bsc',
      ].includes(chainLower)
    ) {
      return this.waitForEvmTransaction(chain, hash, options)
    }

    // For other chains, return pending status
    return {
      hash,
      status: 'pending',
    }
  }

  /**
   * Get transaction status for any supported chain
   */
  async getTransactionStatus(
    chain: string,
    hash: string
  ): Promise<TransactionReceipt> {
    const chainLower = chain.toLowerCase()

    // Route to chain-specific status checkers
    if (
      [
        'ethereum',
        'polygon',
        'arbitrum',
        'optimism',
        'base',
        'avalanche',
        'bsc',
      ].includes(chainLower)
    ) {
      return this.getEvmTransactionStatus(chain, hash)
    }

    // For other chains, return pending status
    return {
      hash,
      status: 'pending',
    }
  }
}
