import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import {
  clampEvmPriorityFee,
  ethereumSendPriorityFeeFloor,
  ethereumSwapPriorityFeeFloor,
} from '@vultisig/core-chain/tx/fee/evm/clampEvmPriorityFee'
import { attempt } from '@vultisig/lib-utils/attempt'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'

const feeHistoryBlockCount = 10
const feeHistoryRewardPercentile = 5
const ethereumFeeHistoryRewardPercentile = 75

// An even count takes the mean of the two middle values, rounded down.
const bigIntMedian = (values: bigint[]): bigint => {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2n : sorted[middle]
}

type EvmPriorityFeeQuote = {
  priorityFee: bigint
  fromFeeHistory: boolean
}

const quoteEvmPriorityFee = async (chain: EvmChain): Promise<EvmPriorityFeeQuote> => {
  const client = getEvmClient(chain)
  const isEthereum = chain === EvmChain.Ethereum

  const [feeHistory, gasPrice] = await Promise.all([
    attempt(
      client.getFeeHistory({
        blockCount: feeHistoryBlockCount,
        rewardPercentiles: [isEthereum ? ethereumFeeHistoryRewardPercentile : feeHistoryRewardPercentile],
      })
    ),
    attempt(client.getGasPrice()),
  ])

  const rewards =
    'error' in feeHistory
      ? []
      : (feeHistory.data.reward ?? []).flatMap(([reward]) => (reward === undefined ? [] : [reward]))

  const fromFeeHistory = rewards.length > 0
  const getRewardTip = () => (isEthereum ? bigIntMedian(rewards) : bigIntMax(...rewards))
  const priorityFee = fromFeeHistory ? getRewardTip() : await client.estimateMaxPriorityFeePerGas()

  if ('error' in gasPrice || priorityFee <= gasPrice.data) {
    return { priorityFee, fromFeeHistory }
  }

  return { priorityFee: gasPrice.data, fromFeeHistory }
}

/**
 * Priority fee suggested by recent blocks: the highest 5th-percentile tip paid
 * in any of the last ten blocks, so the transaction clears even a busy block
 * (on Ethereum, the median of their 75th-percentile tips), falling back to the
 * node's own suggestion when no history is available. Capped at the current
 * gas price when that lookup succeeds; a failed lookup just leaves the tip
 * uncapped rather than failing the quote, since an EIP-1559 tip stands on its
 * own without it.
 */
export const getEvmMaxPriorityFeePerGas = async (chain: EvmChain): Promise<bigint> =>
  (await quoteEvmPriorityFee(chain)).priorityFee

type GetEvmSigningPriorityFeeInput = {
  chain: EvmChain
  isSwap: boolean
}

/**
 * Priority fee to sign with: `getEvmMaxPriorityFeePerGas` clamped to the
 * chain's range by `clampEvmPriorityFee`. An Ethereum tip read from fee history
 * is floored at 0.2 gwei for a send or 0.5 gwei for a swap; a node suggestion
 * keeps the chain's 1 gwei floor.
 */
export const getEvmSigningPriorityFee = async ({ chain, isSwap }: GetEvmSigningPriorityFeeInput): Promise<bigint> => {
  const { priorityFee, fromFeeHistory } = await quoteEvmPriorityFee(chain)

  if (chain === EvmChain.Ethereum && fromFeeHistory) {
    return clampEvmPriorityFee(chain, priorityFee, isSwap ? ethereumSwapPriorityFeeFloor : ethereumSendPriorityFeeFloor)
  }

  return clampEvmPriorityFee(chain, priorityFee)
}
