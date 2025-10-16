import { EvmChain } from '../../core/chain/Chain'
import { getEvmClient } from '../../core/chain/chains/evm/client'
import { AddressDeriver } from '../AddressDeriver'

/**
 * Nonce management utilities for different chains
 */
export class NonceManager {
  private addressDeriver: AddressDeriver

  constructor(addressDeriver: AddressDeriver) {
    this.addressDeriver = addressDeriver
  }

  /**
   * Get nonce for EVM chains
   */
  async getEvmNonce(chain: string, address: string): Promise<number> {
    try {
      const chainEnum = this.addressDeriver.mapStringToChain(chain) as EvmChain
      const client = getEvmClient(chainEnum)

      const nonce = await client.getTransactionCount({
        address: address as `0x${string}`,
        blockTag: 'pending', // Include pending transactions
      })

      return nonce
    } catch (error) {
      console.error('Failed to get EVM nonce:', error)
      throw new Error(`Failed to get nonce: ${(error as Error).message}`)
    }
  }

  /**
   * Get nonce for any supported chain
   */
  async getNonce(chain: string, address: string): Promise<number> {
    const chainLower = chain.toLowerCase()

    // Route to chain-specific nonce getters
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
      return this.getEvmNonce(chain, address)
    }

    // For other chains, return 0 as default
    return 0
  }

  /**
   * Get next nonce (current nonce + 1)
   */
  async getNextNonce(chain: string, address: string): Promise<number> {
    const currentNonce = await this.getNonce(chain, address)
    return currentNonce + 1
  }
}
