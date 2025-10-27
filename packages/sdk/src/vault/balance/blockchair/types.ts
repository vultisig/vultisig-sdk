/**
 * Blockchair API Type Definitions
 * Comprehensive type definitions for Blockchair API responses
 */

export type BlockchairChain =
  | 'bitcoin'
  | 'bitcoin-cash'
  | 'litecoin'
  | 'dogecoin'
  | 'dash'
  | 'zcash'
  | 'ethereum'
  | 'cardano'
  | 'solana'
  | 'ripple'
  | 'polygon'
  | 'avalanche'
  | 'bsc'
  | 'arbitrum'
  | 'optimism'
  | 'base'
  | 'blast'
  | 'zksync'
  | 'cronos'
  | 'mantle'

/**
 * Generic Blockchair API response wrapper
 */
export type BlockchairApiResponse<T = any> = {
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
 * Blockchair address information (UTXO chains)
 */
export type BlockchairUtxoAddress = {
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
 * Blockchair address information (EVM chains)
 */
export type BlockchairEvmAddress = {
  address: {
    type: string
    script_hex: string
    balance: string // Wei as string
    balance_usd: number
    received_approximate: string
    received_usd_approximate: number
    spent_approximate: string
    spent_usd_approximate: number
    fees_approximate: string
    fees_usd_approximate: number
    receiving_call_count: number
    spending_call_count: number
    call_count: number
    transaction_count: number
    first_seen_receiving: string
    last_seen_receiving: string
    first_seen_spending: string
    last_seen_spending: string
    nonce: number | null
  }
  transactions: string[]
  calls: Array<{
    block_id: number
    transaction_hash: string
    transaction_index: number
    index: number
    hash: string
    date: string
    time: string
    from: string
    to: string | null
    value: string
    value_usd: number
    gas_used: number
    gas_price: number
    gas_limit: number
    fee: string
    fee_usd: number
    input_hex: string
    success: boolean
  }>
}

/**
 * Blockchair address information (Cardano)
 */
export type BlockchairCardanoAddress = {
  address: {
    type: string
    balance: string
    balance_usd: number
    received_sum: string
    received_sum_usd: number
    spent_sum: string
    spent_sum_usd: number
    transaction_count: number
    first_seen_receiving: string
    last_seen_receiving: string
    first_seen_spending: string
    last_seen_spending: string
  }
  transactions: string[]
}

/**
 * Blockchair address information (Solana)
 */
export type BlockchairSolanaAddress = {
  address: {
    type: string
    balance: string
    balance_usd: number
    is_contract: boolean
    transaction_count: number
    first_seen_receiving: string
    last_seen_receiving: string
    first_seen_spending: string
    last_seen_spending: string
  }
  transactions: string[]
}

/**
 * Blockchair transaction information (UTXO)
 */
export type BlockchairUtxoTransaction = {
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
 * Blockchair transaction information (EVM)
 */
export type BlockchairEvmTransaction = {
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
    input_total: string
    input_total_usd: number
    output_total: string
    output_total_usd: number
    fee: string
    fee_usd: number
    gas_used: number
    gas_limit: number
    gas_price: string
    nonce: number
    success: boolean
  }
  calls: Array<{
    block_id: number
    transaction_hash: string
    transaction_index: number
    index: number
    hash: string
    date: string
    time: string
    from: string
    to: string | null
    value: string
    value_usd: number
    gas_used: number
    gas_price: string
    gas_limit: number
    fee: string
    fee_usd: number
    input_hex: string
    success: boolean
  }>
}

/**
 * Blockchair stats information
 */
export type BlockchairStats = {
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
 * Blockchair configuration
 */
export type BlockchairConfig = {
  apiKey?: string
  timeout?: number
  retries?: number
  baseUrl?: string
}

/**
 * Union types for different chain types
 */
export type BlockchairAddressData =
  | BlockchairUtxoAddress
  | BlockchairEvmAddress
  | BlockchairCardanoAddress
  | BlockchairSolanaAddress

export type BlockchairTransactionData =
  | BlockchairUtxoTransaction
  | BlockchairEvmTransaction
