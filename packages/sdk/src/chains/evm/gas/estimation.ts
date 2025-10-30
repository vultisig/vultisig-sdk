/**
 * EVM gas estimation utilities
 *
 * Wraps core fee quote functionality with user-friendly interfaces
 */

import { EvmChain } from '@core/chain/Chain'
import { getEvmFeeQuote } from '@core/chain/feeQuote/resolvers/evm'
import { EvmGasEstimate } from '../types'

/**
 * Estimate gas for an EVM transaction
 *
 * Wraps core's getEvmFeeQuote with a simplified interface.
 * Returns gas estimate including base fee, priority fee, and total cost.
 *
 * @param chain - EVM chain to estimate gas for
 * @param transaction - Transaction object with to, from, data, value
 * @returns Gas estimate with all fee components
 */
export async function estimateTransactionGas(
  chain: EvmChain,
  transaction: {
    to: string
    from: string
    data?: string
    value?: bigint
  }
): Promise<EvmGasEstimate> {
  // Call core's fee quote resolver
  const feeQuote = await getEvmFeeQuote({
    coin: {
      chain,
      address: transaction.from,
      decimals: 18,
      ticker: 'ETH',
    },
    amount: transaction.value || 0n,
    receiver: transaction.to,
    data: transaction.data || '0x',
  })

  // Calculate max fee per gas (baseFee * 1.5 + priorityFee)
  const maxFeePerGas =
    (feeQuote.baseFeePerGas * 15n) / 10n + feeQuote.maxPriorityFeePerGas

  // Calculate total estimated cost
  const totalCost = feeQuote.gasLimit * maxFeePerGas

  return {
    baseFeePerGas: feeQuote.baseFeePerGas,
    maxPriorityFeePerGas: feeQuote.maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit: feeQuote.gasLimit,
    totalCost,
  }
}

/**
 * Calculate maximum possible gas cost for a transaction
 *
 * @param gasLimit - Gas limit for the transaction
 * @param maxFeePerGas - Maximum fee per gas in wei
 * @returns Total cost in wei
 */
export function calculateMaxGasCost(
  gasLimit: bigint,
  maxFeePerGas: bigint
): bigint {
  return gasLimit * maxFeePerGas
}

/**
 * Calculate expected gas cost (using base fee, not max fee)
 *
 * @param gasLimit - Gas limit for the transaction
 * @param baseFeePerGas - Base fee per gas in wei
 * @param maxPriorityFeePerGas - Priority fee in wei
 * @returns Expected cost in wei
 */
export function calculateExpectedGasCost(
  gasLimit: bigint,
  baseFeePerGas: bigint,
  maxPriorityFeePerGas: bigint
): bigint {
  return gasLimit * (baseFeePerGas + maxPriorityFeePerGas)
}

/**
 * Estimate gas savings compared to another estimate
 *
 * @param estimate1 - First gas estimate
 * @param estimate2 - Second gas estimate
 * @returns Savings in wei (positive if estimate1 is cheaper)
 */
export function compareGasEstimates(
  estimate1: EvmGasEstimate,
  estimate2: EvmGasEstimate
): {
  costDifference: bigint
  percentageDifference: number
  cheaperEstimate: 1 | 2
} {
  const difference = estimate2.totalCost - estimate1.totalCost
  const percentage =
    (Number(difference) / Number(estimate2.totalCost)) * 100

  return {
    costDifference: difference > 0n ? difference : -difference,
    percentageDifference: Math.abs(percentage),
    cheaperEstimate: difference > 0n ? 1 : 2,
  }
}
