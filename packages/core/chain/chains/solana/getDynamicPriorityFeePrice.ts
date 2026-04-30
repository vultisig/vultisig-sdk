import { PublicKey } from '@solana/web3.js'

import { getSolanaClient } from './client'
import { solanaConfig } from './solanaConfig'

const PRIORITY_FEE_PERCENTILE = 0.75

/**
 * Fetches the 75th-percentile non-zero recent prioritization fee from the
 * Solana RPC. When `writableAccounts` is provided, the query is scoped to
 * slots that wrote to those accounts (vault-aware) — the global feed is
 * dominated by no-op vote txs and underestimates fees for contended
 * writes. Floors at `solanaConfig.priorityFeePrice` so a low-congestion
 * percentile never undershoots the cross-platform minimum.
 */
export const getDynamicPriorityFeePrice = async (
    writableAccounts: PublicKey[] = []
): Promise<number> => {
    const client = getSolanaClient()

    const recentFees = await client.getRecentPrioritizationFees(
        writableAccounts.length > 0
            ? { lockedWritableAccounts: writableAccounts }
            : undefined
    )

    const nonZeroFees = recentFees
        .map(entry => entry.prioritizationFee)
        .filter(fee => fee > 0)
        .sort((a, b) => a - b)

    if (nonZeroFees.length === 0) {
        return solanaConfig.priorityFeePrice
    }

    const index = Math.min(
        Math.floor(nonZeroFees.length * PRIORITY_FEE_PERCENTILE),
        nonZeroFees.length - 1
    )

    return Math.max(nonZeroFees[index], solanaConfig.priorityFeePrice)
}
