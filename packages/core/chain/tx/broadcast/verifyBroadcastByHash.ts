import { sleep } from '@vultisig/lib-utils/sleep'

import { Chain } from '../../Chain'
import { SigningOutput } from '../../tw/signingOutput'
import { getTxHash } from '../hash'
import { getTxStatus } from '../status'

type VerifyInput<T extends Chain> = {
  chain: T
  tx: SigningOutput<T>
  error: unknown
}

export const broadcastVerificationMaxAttempts = 4
export const broadcastVerificationBaseDelayMs = 500

/**
 * Hash-verification safety net for broadcast resolvers.
 *
 * In MPC keysign every participating device broadcasts the same signed
 * transaction independently. When a peer wins the RPC race, the slower
 * device gets an "already known / duplicate / in mempool" error, but the
 * transaction is in fact on-chain (or in the mempool). Per-chain error
 * string matching is fragile across RPC providers and versions; the
 * deterministic signal is the tx hash itself.
 *
 * This helper derives the hash once, then retries `getTxStatus` briefly to
 * allow for RPC propagation and indexing lag.
 * If the status lookup confirms the transaction exists (pending or
 * success), the broadcast error is swallowed. Otherwise the original
 * error is re-thrown so the caller sees the real failure.
 *
 * A terminal failed status rethrows immediately. Unknown/not-found status and
 * transient status lookup failures exhaust the bounded verification window
 * before the original error is rethrown. Verification is a safety net, never
 * a new failure mode.
 */
export const verifyBroadcastByHash = async <T extends Chain>({ chain, tx, error }: VerifyInput<T>): Promise<void> => {
  let hash: string

  try {
    hash = await getTxHash({ chain, tx })
  } catch {
    throw error
  }

  for (let attempt = 1; attempt <= broadcastVerificationMaxAttempts; attempt++) {
    let result: Awaited<ReturnType<typeof getTxStatus>> | undefined

    try {
      result = await getTxStatus({ chain, hash })
    } catch {
      // Retry status lookup failures within the same bounded window.
    }

    if (result) {
      const isKnownPending = result.status === 'pending' && result.isKnown !== false

      if (result.status === 'success' || isKnownPending) {
        return
      }

      if (result.status === 'error') {
        break
      }
    }

    if (attempt < broadcastVerificationMaxAttempts) {
      await sleep(broadcastVerificationBaseDelayMs * attempt)
    }
  }

  throw error
}
