import { PublicKey } from '@solana/web3.js'

import { getSolanaClient } from './client'
import { solanaConfig } from './solanaConfig'

const PRIORITY_FEE_PERCENTILE = 0.75

/**
 * Minimum sample size before the percentile selection is statistically
 * meaningful. With the new lockedWritableAccounts scoping, sparse windows
 * (1-3 non-zero fee slots in the recent window) become more likely - a
 * single LP-add slot at e.g. 50_000_000 µLam/CU would dominate the
 * percentile and set a wildly inflated fee for the next caller. Math.max
 * floor below only protects against UNDER-payment; this guard protects
 * against OVER-payment from a sparse-window spike. Below threshold we
 * fall back to the cross-platform floor as the base rate (effectively
 * "we don't have enough signal, pay the minimum").
 */
const MIN_SAMPLE_SIZE = 5

/**
 * Fetches the 75th-percentile non-zero recent prioritization fee from the
 * Solana RPC. When `writableAccounts` is provided, the query is scoped to
 * slots that wrote to those accounts (vault-aware) — the global feed is
 * dominated by no-op vote txs and underestimates fees for contended
 * writes. Floors at `solanaConfig.priorityFeePrice` so a low-congestion
 * percentile never undershoots the cross-platform minimum, AND falls
 * back to the floor when the sample window is too sparse to extrapolate
 * a reliable percentile (see MIN_SAMPLE_SIZE).
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

    // Sparse-window guard: too few non-zero samples means a single
    // outlier slot would dominate the percentile. Fall back to floor.
    if (nonZeroFees.length < MIN_SAMPLE_SIZE) {
        return solanaConfig.priorityFeePrice
    }

    const index = Math.min(
        Math.floor(nonZeroFees.length * PRIORITY_FEE_PERCENTILE),
        nonZeroFees.length - 1
    )

    return Math.max(nonZeroFees[index], solanaConfig.priorityFeePrice)
}

// Test-only export: lets unit tests pin the threshold without re-stating
// the magic number. Not exported from package barrel.
export const _MIN_SAMPLE_SIZE_FOR_TEST = MIN_SAMPLE_SIZE
