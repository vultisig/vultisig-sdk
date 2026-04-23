import { Chain } from '../../Chain'
import { SigningOutput } from '../../tw/signingOutput'
import { getTxHash } from '../hash'
import { getTxStatus } from '../status'

type VerifyInput<T extends Chain> = {
  chain: T
  tx: SigningOutput<T>
  error: unknown
}

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
 * This helper re-runs `getTxHash` + `getTxStatus` on the signed output.
 * If the status lookup confirms the transaction exists (pending or
 * success), the broadcast error is swallowed. Otherwise the original
 * error is re-thrown so the caller sees the real failure.
 *
 * Any failure inside verification (hash/status RPC down, tx not indexed
 * yet, network error) falls through to re-throwing the original error —
 * verification is a safety net, never a new failure mode.
 */
export const verifyBroadcastByHash = async <T extends Chain>({
  chain,
  tx,
  error,
}: VerifyInput<T>): Promise<void> => {
  try {
    const hash = await getTxHash({ chain, tx })
    const result = await getTxStatus({ chain, hash })
    if (result.status === 'pending' || result.status === 'success') {
      return
    }
  } catch {
    // fall through — verification unavailable, rethrow the original error
  }
  throw error
}
