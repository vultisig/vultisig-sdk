import { EvmChain } from '../../core/chain/Chain'
import { getEvmClient } from '../../core/chain/chains/evm/client'
import { AddressDeriver } from '../AddressDeriver'

/**
 * Gas estimation utilities for different chains
 */
export class GasEstimator {
  private addressDeriver: AddressDeriver

  constructor(addressDeriver: AddressDeriver) {
    this.addressDeriver = addressDeriver
  }

  /**
   * Estimate gas for EVM transactions
   */
  async estimateEvmGas(
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
    try {
      const chainEnum = this.addressDeriver.mapStringToChain(chain) as EvmChain
      const client = getEvmClient(chainEnum)

      // Estimate gas limit
      const gasEstimate = await client.estimateGas({
        to: transaction.to as `0x${string}`,
        value: transaction.value ? BigInt(transaction.value) : undefined,
        data: (transaction.data || '0x') as `0x${string}`,
        account: transaction.from as `0x${string}`,
      })

      // Get current gas price
      const gasPrice = await client.getGasPrice()

      // For EIP-1559 chains, get fee data
      let maxFeePerGas: bigint | undefined
      let maxPriorityFeePerGas: bigint | undefined

      try {
        const feeData = await client.estimateFeesPerGas()
        maxFeePerGas = feeData.maxFeePerGas
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      } catch {
        // Fallback to legacy gas price for non-EIP-1559 chains
      }

      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
        maxFeePerGas: maxFeePerGas?.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas?.toString(),
      }
    } catch (error) {
      console.error('Failed to estimate EVM gas:', error)
      throw new Error(`Gas estimation failed: ${(error as Error).message}`)
    }
  }

  /**
   * Estimate gas for any supported chain
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
    const chainLower = chain.toLowerCase()

    // Route to chain-specific estimators
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
      return this.estimateEvmGas(chain, transaction)
    }

    // For other chains, return default values
    return {
      gasLimit: '21000', // Default for simple transfers
      gasPrice: '20000000000', // 20 gwei default
    }
  }
}
