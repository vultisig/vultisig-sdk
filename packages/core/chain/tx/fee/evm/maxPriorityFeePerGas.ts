import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'

const feeHistoryBlockCount = 10
const feeHistoryRewardPercentile = 5

/**
 * Priority fee to sign with: the highest 5th-percentile tip paid in any of the
 * last ten blocks, so the transaction clears even a busy block, falling back to
 * the node's own suggestion when no history is available. Never above the
 * current gas price, which is all a legacy-priced chain can pay.
 */
export const getEvmMaxPriorityFeePerGas = async (chain: EvmChain): Promise<bigint> => {
  const client = getEvmClient(chain)

  const [feeHistory, gasPrice] = await Promise.all([
    attempt(
      client.getFeeHistory({
        blockCount: feeHistoryBlockCount,
        rewardPercentiles: [feeHistoryRewardPercentile],
      })
    ),
    client.getGasPrice(),
  ])

  const rewards =
    'error' in feeHistory
      ? []
      : (feeHistory.data.reward ?? []).flatMap(([reward]) => (reward === undefined ? [] : [reward]))

  const priorityFee = rewards.length > 0 ? bigIntMax(...rewards) : await client.estimateMaxPriorityFeePerGas()

  return priorityFee > gasPrice ? gasPrice : priorityFee
}
