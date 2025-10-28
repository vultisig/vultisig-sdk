/**
 * Blockchair API Client
 * Comprehensive blockchain data indexing service integration
 *
 * Blockchair provides extensive blockchain data for:
 * - UTXO chains: Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash, Zcash
 * - EVM chains: Ethereum and all ERC-20 compatible chains
 * - Other chains: Cardano, Solana, Ripple, etc.
 *
 * API Documentation: https://blockchair.com/api/docs
 */

import { memoize } from '@lib/utils/memoize'
import { queryUrl } from '@lib/utils/query/queryUrl'
import type {
  BlockchairChain as ImportedBlockchairChain,
  BlockchairApiResponse,
  BlockchairStats,
  BlockchairAddressData as ImportedBlockchairAddressData,
  BlockchairTransactionData as ImportedBlockchairTransactionData,
  BlockchairConfig as ImportedBlockchairConfig,
} from './types'

// Blockchair API base URL
export const BLOCKCHAIR_API_BASE = 'https://api.blockchair.com'

// Supported chains mapping (Blockchair naming convention)
export const BLOCKCHAIR_CHAIN_NAMES = {
  bitcoin: 'bitcoin',
  'bitcoin-cash': 'bitcoin-cash',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  dash: 'dash',
  zcash: 'zcash',
  ethereum: 'ethereum',
  cardano: 'cardano',
  solana: 'solana',
  ripple: 'ripple',
  polygon: 'polygon',
  avalanche: 'avalanche',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  blast: 'blast',
  zksync: 'zksync',
  cronos: 'cronos',
  mantle: 'mantle',
} as const

export type BlockchairChain = keyof typeof BLOCKCHAIR_CHAIN_NAMES

/**
 * Generic Blockchair API response structure
 */
export type BlockchairResponse<T = any> = {
  data: T
  context: {
    code: number
    source: string
    time: number
    limit: number
    offset: number
    results: number
    state: number
    cache: {
      live: boolean
      duration: number
      since: number
      until: number
      time: number | null
    }
    api: {
      version: string
      last_major_update: string
      next_major_update: string | null
      documentation: string
      notice?: string
    }
  }
}

/**
 * Blockchair address data structure
 */
export type BlockchairAddressData = {
  address: {
    type: string
    script_hex: string
    balance: number
    balance_usd: number
    received: number
    received_usd: number
    spent: number
    spent_usd: number
    output_count: number
    unspent_output_count: number
    first_seen_receiving: string
    last_seen_receiving: string
    first_seen_spending: string
    last_seen_spending: string
    scripthash_type: string | null
    transaction_count: number
  }
  utxo: Array<{
    block_id: number
    transaction_hash: string
    index: number
    value: number
    value_usd: number
    recipient: string
    script_hex: string
    is_from_coinbase: boolean
    is_spendable: boolean
  }>
  transactions: string[]
}

/**
 * Blockchair transaction data structure
 */
export type BlockchairTransactionData = {
  transaction: {
    block_id: number
    id: number
    hash: string
    date: string
    time: string
    size: number
    weight: number
    version: number
    lock_time: number
    is_coinbase: boolean
    has_witness: boolean
    input_count: number
    output_count: number
    input_total: number
    input_total_usd: number
    output_total: number
    output_total_usd: number
    fee: number
    fee_usd: number
    fee_per_kb: number
    fee_per_kb_usd: number
    fee_per_kwu: number
    fee_per_kwu_usd: number
    fee_per_kb_total: number
    fee_per_kb_total_usd: number
    fee_per_kwu_total: number
    fee_per_kwu_total_usd: number
  }
  inputs: Array<{
    block_id: number
    transaction_id: number
    index: number
    transaction_hash: string
    date: string
    time: string
    value: number
    value_usd: number
    recipient: string
    type: string
    script_hex: string
    is_from_coinbase: boolean
    is_spendable: boolean
    is_spent: boolean
    spending_block_id: number
    spending_transaction_id: number
    spending_index: number
    spending_transaction_hash: string
    spending_date: string
    spending_time: string
    lifespan: number
  }>
  outputs: Array<{
    block_id: number
    transaction_id: number
    index: number
    transaction_hash: string
    date: string
    time: string
    value: number
    value_usd: number
    recipient: string
    type: string
    script_hex: string
    is_from_coinbase: boolean
    is_spendable: boolean
    is_spent: boolean
    spending_block_id: number
    spending_transaction_id: number
    spending_index: number
    spending_transaction_hash: string
    spending_date: string
    spending_time: string
    lifespan: number
  }>
}

/**
 * Blockchair stats data structure
 */
export type BlockchairStatsData = {
  blocks: number
  transactions: number
  outputs: number
  circulation: number
  blocks_24h: number
  transactions_24h: number
  difficulty: number
  volume_24h: number
  mempool_transactions: number
  mempool_size: number
  mempool_tps: number
  mempool_total_fee_usd: number
  best_block_height: number
  best_block_hash: string
  best_block_time: string
  blockchain_size: number
  average_transaction_fee_24h: number
  inflation_usd_24h: number
  median_transaction_fee_24h: number
  cdd_24h: number
  largest_transaction_24h: {
    hash: string
    value_usd: number
  }
  nodes: number
  hashrate_24h: string
  inflation_24h: number
  market_price_usd: number
  market_price_btc: number
  market_price_usd_change_24h_percentage: number
  market_dominance_percentage: number
  next_retarget_time_estimate: string | null
  next_difficulty_estimate: number | null
  countdowns: {
    retarget: number | null
    difficulty: number | null
  }
}

/**
 * Blockchair client configuration
 */
export type BlockchairConfig = {
  apiKey?: string // For premium features
  timeout?: number
  retries?: number
}

/**
 * Main Blockchair API client class
 */
export class BlockchairClient {
  private config: BlockchairConfig

  constructor(config: BlockchairConfig = {}) {
    this.config = {
      timeout: 10000,
      retries: 3,
      ...config,
    }
  }

  /**
   * Get address information for any supported chain
   */
  async getAddressInfo(
    chain: BlockchairChain,
    address: string
  ): Promise<BlockchairAddressData> {
    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/dashboards/address/${address}?state=latest`

    const response =
      await queryUrl<
        BlockchairResponse<{ [key: string]: BlockchairAddressData }>
      >(url)

    if (!response.data[address]) {
      throw new Error(`Address ${address} not found on ${chain}`)
    }

    return response.data[address]
  }

  /**
   * Get transaction information for any supported chain
   */
  async getTransactionInfo(
    chain: BlockchairChain,
    txHash: string
  ): Promise<BlockchairTransactionData> {
    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/dashboards/transaction/${txHash}`

    const response =
      await queryUrl<
        BlockchairResponse<{ [key: string]: BlockchairTransactionData }>
      >(url)

    if (!response.data[txHash]) {
      throw new Error(`Transaction ${txHash} not found on ${chain}`)
    }

    return response.data[txHash]
  }

  /**
   * Get blockchain statistics for any supported chain
   */
  async getStats(chain: BlockchairChain): Promise<BlockchairStatsData> {
    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/stats`

    const response =
      await queryUrl<BlockchairResponse<BlockchairStatsData>>(url)
    return response.data
  }

  /**
   * Get raw transaction data (UTXO chains only)
   */
  async getRawTransaction(
    chain: BlockchairChain,
    txHash: string
  ): Promise<string> {
    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/raw/transaction/${txHash}`

    const response =
      await queryUrl<BlockchairResponse<{ [key: string]: string }>>(url)
    return response.data[txHash]
  }

  /**
   * Broadcast transaction (UTXO chains only)
   */
  async broadcastTransaction(
    chain: BlockchairChain,
    rawTx: string
  ): Promise<{ txid: string }> {
    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/push/transaction`

    const response = await queryUrl<BlockchairResponse<{ txid: string }>>(url, {
      method: 'POST',
      body: { data: rawTx },
    })

    return response.data
  }

  /**
   * Get multiple addresses information in batch
   */
  async getAddressesInfo(
    chain: BlockchairChain,
    addresses: string[]
  ): Promise<{ [address: string]: BlockchairAddressData }> {
    if (addresses.length === 0) return {}

    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const addressesParam = addresses.join(',')
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/dashboards/addresses/${addressesParam}?state=latest`

    const response =
      await queryUrl<
        BlockchairResponse<{ [key: string]: BlockchairAddressData }>
      >(url)
    return response.data
  }

  /**
   * Get multiple transactions information in batch
   */
  async getTransactionsInfo(
    chain: BlockchairChain,
    txHashes: string[]
  ): Promise<{ [txHash: string]: BlockchairTransactionData }> {
    if (txHashes.length === 0) return {}

    const chainName = BLOCKCHAIR_CHAIN_NAMES[chain]
    const hashesParam = txHashes.join(',')
    const url = `${BLOCKCHAIR_API_BASE}/${chainName}/dashboards/transactions/${hashesParam}`

    const response =
      await queryUrl<
        BlockchairResponse<{ [key: string]: BlockchairTransactionData }>
      >(url)
    return response.data
  }
}

// Singleton instance for convenience
export const blockchairClient = new BlockchairClient()

// Memoized clients for performance
export const getBlockchairClient = memoize(
  (config?: BlockchairConfig) => new BlockchairClient(config)
)

// The BlockchairClient class is already exported above

// Export resolvers
export { getBlockchairCardanoCoinBalance } from './resolvers/cardano'
export { getBlockchairEvmCoinBalance } from './resolvers/evm'
export { getBlockchairSolanaCoinBalance } from './resolvers/solana'
export {
  type BlockchairTransactionInfo,
  getBlockchairTransaction,
  getBlockchairTransactions,
} from './resolvers/transaction'

// Export configuration
export {
  type BlockchairProviderConfig,
  type ChainDataSourceConfig,
  createBlockchairConfig,
  type DataSource,
  getBlockchairChainName,
  getDataSourceForChain,
  isChainSupportedByBlockchair,
  validateBlockchairConfig,
} from './config'

// Export integration helpers
export {
  blockchairFirstResolver,
  createSmartBalanceResolver,
  createSmartTransactionResolver,
  getBalanceWithBlockchair,
  getTransactionWithBlockchair,
  rpcOnlyResolver,
  selectiveBlockchairResolver,
  SmartBalanceResolver,
  SmartTransactionResolver,
} from './integration'
