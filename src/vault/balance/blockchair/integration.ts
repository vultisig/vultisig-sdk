/**
 * Blockchair Integration Module
 * Provides seamless switching between Blockchair and direct RPC calls
 */

import { Chain, EvmChain } from '../../../core/chain/Chain'
import { ChainAccount } from '../../../core/chain/ChainAccount'
import { AccountCoinKey } from '../../../core/chain/coin/AccountCoin'
import { getCoinBalance } from '../../../core/chain/coin/balance'

import { AddressDeriver } from '../../../chains/AddressDeriver'
import {
  BlockchairProviderConfig,
  createBlockchairConfig,
  getDataSourceForChain,
  isChainSupportedByBlockchair,
} from './config'
import { getBlockchairCardanoCoinBalance } from './resolvers/cardano'
import { getBlockchairEvmCoinBalance } from './resolvers/evm'
import { getBlockchairSolanaCoinBalance } from './resolvers/solana'

/**
 * Enhanced balance resolver that can switch between data sources
 */
export class SmartBalanceResolver {
  private config: BlockchairProviderConfig

  constructor(config: BlockchairProviderConfig = createBlockchairConfig()) {
    this.config = config
  }

  /**
   * Get balance using the configured data source preference
   */
  async getBalance(input: ChainAccount): Promise<bigint> {
    const dataSource = getDataSourceForChain(input.chain, this.config)

    if (
      dataSource === 'blockchair' &&
      isChainSupportedByBlockchair(input.chain)
    ) {
      try {
        return await this.getBlockchairBalance(input)
      } catch (error) {
        console.warn(
          `Blockchair balance fetch failed for ${input.chain}, falling back to RPC:`,
          error
        )

        if (this.config.fallbackToRpc) {
          return await getCoinBalance(input)
        }

        throw error
      }
    }

    // Use standard RPC balance resolver
    return await getCoinBalance(input)
  }

  /**
   * Get balance using Blockchair specifically
   */
  private async getBlockchairBalance(input: ChainAccount): Promise<bigint> {
    switch (input.chain) {
      // EVM chains
      case Chain.Ethereum:
      case Chain.Base:
      case Chain.Arbitrum:
      case Chain.Polygon:
      case Chain.Optimism:
      case Chain.BSC:
      case Chain.Avalanche:
      case Chain.Blast:
      case Chain.Zksync:
      case Chain.CronosChain:
      case Chain.Mantle:
        return await getBlockchairEvmCoinBalance(
          input as AccountCoinKey<EvmChain>
        )

      // Solana
      case Chain.Solana:
        return await getBlockchairSolanaCoinBalance(input)

      // Cardano
      case Chain.Cardano:
        return await getBlockchairCardanoCoinBalance(input)

      // UTXO chains already use Blockchair via existing infrastructure
      case Chain.Bitcoin:
      case Chain.BitcoinCash:
      case Chain.Litecoin:
      case Chain.Dogecoin:
      case Chain.Dash:
      case Chain.Zcash:
        return await getCoinBalance(input) // Uses existing Blockchair integration

      default:
        throw new Error(
          `Blockchair balance resolver not implemented for chain: ${input.chain}`
        )
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BlockchairProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): BlockchairProviderConfig {
    return { ...this.config }
  }
}

/**
 * Transaction resolver that can use Blockchair for lookups
 */
export class SmartTransactionResolver {
  private config: BlockchairProviderConfig
  private addressDeriver = new AddressDeriver()

  constructor(config: BlockchairProviderConfig = createBlockchairConfig()) {
    this.config = config
  }

  /**
   * Get transaction information using preferred data source
   */
  async getTransaction(chain: string, txHash: string) {
    // Map string chain name to Chain enum value
    const chainEnum = this.addressDeriver.mapStringToChain(chain)
    const dataSource = getDataSourceForChain(chainEnum, this.config)

    if (
      dataSource === 'blockchair' &&
      isChainSupportedByBlockchair(chainEnum)
    ) {
      try {
        const { getBlockchairTransaction } = await import(
          './resolvers/transaction'
        )
        return await getBlockchairTransaction(chain, txHash)
      } catch (error) {
        console.warn(
          `Blockchair transaction lookup failed for ${chain}:${txHash}:`,
          error
        )
        throw error
      }
    }

    // Fallback to chain-specific transaction lookup
    throw new Error(`Transaction lookup not available for chain: ${chain}`)
  }
}

/**
 * Factory functions for easy integration
 */

export function createSmartBalanceResolver(
  config?: Partial<BlockchairProviderConfig>
): SmartBalanceResolver {
  return new SmartBalanceResolver(createBlockchairConfig(config))
}

export function createSmartTransactionResolver(
  config?: Partial<BlockchairProviderConfig>
): SmartTransactionResolver {
  return new SmartTransactionResolver(createBlockchairConfig(config))
}

/**
 * Pre-configured instances for common use cases
 */

// Use Blockchair for all supported chains
export const blockchairFirstResolver = createSmartBalanceResolver({
  enabled: true,
  fallbackToRpc: true,
})

// Use RPC for all chains (default behavior)
export const rpcOnlyResolver = createSmartBalanceResolver({
  enabled: false,
})

// Use Blockchair only for specific chains
export const selectiveBlockchairResolver = createSmartBalanceResolver({
  enabled: true,
  chainOverrides: {
    [Chain.Ethereum]: 'blockchair',
    [Chain.Bitcoin]: 'blockchair',
    [Chain.Solana]: 'blockchair',
  },
  fallbackToRpc: true,
})

// Export convenience functions
export async function getBalanceWithBlockchair(
  input: ChainAccount,
  config?: Partial<BlockchairProviderConfig>
): Promise<bigint> {
  const resolver = createSmartBalanceResolver(config)
  return await resolver.getBalance(input)
}

export async function getTransactionWithBlockchair(
  chain: string,
  txHash: string,
  config?: Partial<BlockchairProviderConfig>
) {
  const resolver = createSmartTransactionResolver(config)
  return await resolver.getTransaction(chain, txHash)
}
