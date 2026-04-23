import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'

import { solanaConfig } from './solanaConfig'

/** Fetches the median of non-zero recent prioritization fees from the Solana RPC. */
export const getDynamicPriorityFeePrice = async (): Promise<number> => {
    const client = getSolanaClient()

    const recentFees = await client.getRecentPrioritizationFees()

    const nonZeroFees = recentFees
        .map(entry => entry.prioritizationFee)
        .filter(fee => fee > 0)
        .sort((a, b) => a - b)

    if (nonZeroFees.length === 0) {
        return solanaConfig.priorityFeePrice
    }

    const mid = Math.floor(nonZeroFees.length / 2)

    if (nonZeroFees.length % 2 === 0) {
        return Math.round((nonZeroFees[mid - 1] + nonZeroFees[mid]) / 2)
    }

    return nonZeroFees[mid]
}
