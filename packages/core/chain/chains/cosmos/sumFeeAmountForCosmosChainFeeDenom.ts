import { CosmosChain } from '../../Chain'
import { cosmosFeeCoinDenom } from './cosmosFeeCoinDenom'

export type SumFeeAmountForCosmosChainFeeDenomInput = {
  amounts: readonly { denom: string; amount: string }[] | undefined
  chain: CosmosChain
}

/**
 * Sums fee `amount` fields for entries whose `denom` matches the chain's native
 * fee denom ({@link cosmosFeeCoinDenom}), compared case-insensitively.
 * Returns null when there is nothing to sum or no matching denoms.
 */
export const sumFeeAmountForCosmosChainFeeDenom = ({
  amounts,
  chain,
}: SumFeeAmountForCosmosChainFeeDenomInput): bigint | null => {
  if (!amounts?.length) {
    return null
  }

  const targetDenom = cosmosFeeCoinDenom[chain].toLowerCase()
  let sum = 0n
  let matched = false

  for (const { denom, amount } of amounts) {
    if (denom.toLowerCase() === targetDenom) {
      matched = true
      sum += BigInt(amount)
    }
  }

  return matched ? sum : null
}
