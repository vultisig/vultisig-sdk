import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

import { getSolanaClient } from './client'
import { withSolanaRpcTimeout } from './rpcTimeout'
import { solanaConfig } from './solanaConfig'

/** Data size of an SPL Token account (`spl_token::state::Account::LEN`). */
export const splTokenAccountSize = 165

/**
 * How long a live rent read is reused. Rent changes only through feature
 * activations at epoch boundaries (about every two days), so an hour keeps
 * the value current without an RPC call on every quote.
 */
export const solanaTokenAccountRentCacheTimeMs = 60 * 60 * 1000

const fetchSolanaTokenAccountRent = memoizeAsync(
  async (): Promise<bigint> => {
    const lamports = await withSolanaRpcTimeout(
      getSolanaClient().getMinimumBalanceForRentExemption(splTokenAccountSize),
      'getMinimumBalanceForRentExemption'
    )
    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
      throw new Error(`Unexpected Solana token-account rent: ${lamports}`)
    }

    return BigInt(lamports)
  },
  { cacheTime: solanaTokenAccountRentCacheTimeMs }
)

/**
 * Rent-exempt minimum, in lamports, that the payer funds when a transaction
 * creates an SPL token account (an associated token account for a recipient
 * or a swap fee account).
 *
 * Read live from `getMinimumBalanceForRentExemption(165)` and cached, because
 * Solana keeps lowering the rent rate (SIMD-0437). When the RPC fails, falls
 * back to `solanaConfig.ataRentLamports`, the pre-SIMD-0437 value. That is an
 * upper bound, so a fallback quote can be too high but never too low. A failed
 * read is not cached, so the next call tries the RPC again.
 */
export const getSolanaTokenAccountRent = async (): Promise<bigint> => {
  try {
    return await fetchSolanaTokenAccountRent()
  } catch {
    return BigInt(solanaConfig.ataRentLamports)
  }
}
