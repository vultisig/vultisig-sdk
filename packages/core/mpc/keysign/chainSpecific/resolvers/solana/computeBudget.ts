import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { assertBoundedInt } from '@vultisig/lib-utils/bigint/assertBoundedInt'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'

/** Keep fee estimation and the encoded send's compute budget identical. */
export const getSolanaComputeBudget = ({
  priorityFee,
  computeLimit,
}: {
  priorityFee?: string
  computeLimit?: string
}) => ({
  price: maxBigInt(
    priorityFee ? BigInt(assertBoundedInt(priorityFee, 'uint64')) : 0n,
    BigInt(solanaConfig.priorityFeePrice)
  ),
  limit: computeLimit ? Number(computeLimit) : solanaConfig.priorityFeeLimit,
})
