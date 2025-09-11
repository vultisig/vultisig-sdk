/**
 * Blockchair Transaction Resolver
 * Uses Blockchair API for transaction queries across multiple chains
 */

import { Chain } from '@core/chain/Chain'

import { BlockchairChain, blockchairClient } from '../index'

/**
 * Map Vultisig chain names to Blockchair chain names for transaction lookups
 */
const TRANSACTION_CHAIN_MAPPING: Record<string, BlockchairChain> = {
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoin-cash',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Dash]: 'dash',
  [Chain.Zcash]: 'zcash',
  [Chain.Ethereum]: 'ethereum',
  [Chain.Base]: 'base',
  [Chain.Arbitrum]: 'arbitrum',
  [Chain.Polygon]: 'polygon',
  [Chain.Optimism]: 'optimism',
  [Chain.BSC]: 'bsc',
  [Chain.Avalanche]: 'avalanche',
  [Chain.Cardano]: 'cardano',
  [Chain.Solana]: 'solana',
  [Chain.Ripple]: 'ripple',
}

/**
 * Blockchair transaction data structure
 */
export type BlockchairTransactionInfo = {
  hash: string
  blockId: number
  timestamp: string
  confirmations?: number
  fee: string
  feeUsd: number
  value: string
  valueUsd: number
  from: string[]
  to: string[]
  success: boolean
  type: 'utxo' | 'evm' | 'other'
}

/**
 * Get transaction information using Blockchair
 */
export async function getBlockchairTransaction(
  chain: string,
  txHash: string
): Promise<BlockchairTransactionInfo> {
  const blockchairChain = TRANSACTION_CHAIN_MAPPING[chain]

  if (!blockchairChain) {
    throw new Error(
      `Blockchair does not support transaction lookups for chain: ${chain}`
    )
  }

  try {
    const txData = await blockchairClient.getTransactionInfo(
      blockchairChain,
      txHash
    )

    // Handle different transaction types based on chain
    if (
      [
        'bitcoin',
        'bitcoin-cash',
        'litecoin',
        'dogecoin',
        'dash',
        'zcash',
      ].includes(blockchairChain)
    ) {
      // UTXO transaction
      const utxoTx = txData as any
      return {
        hash: utxoTx.transaction.hash,
        blockId: utxoTx.transaction.block_id,
        timestamp: utxoTx.transaction.time,
        fee: utxoTx.transaction.fee?.toString() || '0',
        feeUsd: utxoTx.transaction.fee_usd || 0,
        value: utxoTx.transaction.output_total?.toString() || '0',
        valueUsd: utxoTx.transaction.output_total_usd || 0,
        from: utxoTx.inputs?.map((input: any) => input.recipient) || [],
        to: utxoTx.outputs?.map((output: any) => output.recipient) || [],
        success: true, // UTXO transactions are always successful once mined
        type: 'utxo',
      }
    } else if (
      [
        'ethereum',
        'base',
        'arbitrum',
        'polygon',
        'optimism',
        'bsc',
        'avalanche',
      ].includes(blockchairChain)
    ) {
      // EVM transaction
      const evmTx = txData as any
      const transaction = evmTx.transaction
      const calls = evmTx.calls || []

      return {
        hash: transaction.hash,
        blockId: transaction.block_id,
        timestamp: transaction.time,
        fee: transaction.fee || '0',
        feeUsd: transaction.fee_usd || 0,
        value: calls.length > 0 ? calls[0].value : '0',
        valueUsd: calls.length > 0 ? calls[0].value_usd : 0,
        from: calls.map((call: any) => call.from).filter(Boolean),
        to: calls.map((call: any) => call.to).filter(Boolean),
        success: transaction.success,
        type: 'evm',
      }
    } else {
      // Other chains (Cardano, Solana, Ripple)
      const otherTx = txData as any
      return {
        hash: otherTx.transaction?.hash || txHash,
        blockId: otherTx.transaction?.block_id || 0,
        timestamp: otherTx.transaction?.time || '',
        fee: otherTx.transaction?.fee?.toString() || '0',
        feeUsd: otherTx.transaction?.fee_usd || 0,
        value: otherTx.transaction?.output_total?.toString() || '0',
        valueUsd: otherTx.transaction?.output_total_usd || 0,
        from: [],
        to: [],
        success: true,
        type: 'other',
      }
    }
  } catch (error) {
    console.warn(
      `Blockchair transaction lookup failed for ${chain}:${txHash}:`,
      error
    )

    // Fallback: try to get basic transaction info from chain-specific APIs
    try {
      return await getFallbackTransactionInfo(chain, txHash)
    } catch {
      throw new Error(`Transaction lookup failed for ${chain}:${txHash}`)
    }
  }
}

/**
 * Fallback transaction lookup using chain-specific APIs
 */
async function getFallbackTransactionInfo(
  chain: string,
  txHash: string
): Promise<BlockchairTransactionInfo> {
  // This would implement fallbacks to chain-specific APIs
  // For now, return a basic structure
  return {
    hash: txHash,
    blockId: 0,
    timestamp: '',
    fee: '0',
    feeUsd: 0,
    value: '0',
    valueUsd: 0,
    from: [],
    to: [],
    success: false,
    type: 'other',
  }
}

/**
 * Get multiple transactions information in batch
 */
export async function getBlockchairTransactions(
  chain: string,
  txHashes: string[]
): Promise<Record<string, BlockchairTransactionInfo>> {
  const blockchairChain = TRANSACTION_CHAIN_MAPPING[chain]

  if (!blockchairChain) {
    throw new Error(
      `Blockchair does not support batch transaction lookups for chain: ${chain}`
    )
  }

  try {
    const txData = await blockchairClient.getTransactionsInfo(
      blockchairChain,
      txHashes
    )

    const result: Record<string, BlockchairTransactionInfo> = {}

    for (const hash of Object.keys(txData)) {
      // Reuse the single transaction processing logic
      const processed = await getBlockchairTransaction(chain, hash)
      result[hash] = processed
    }

    return result
  } catch (error) {
    console.warn(
      `Blockchair batch transaction lookup failed for ${chain}:`,
      error
    )
    throw error
  }
}
