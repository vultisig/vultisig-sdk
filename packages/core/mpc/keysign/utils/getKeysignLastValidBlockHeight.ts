import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

const maxSafeBlockHeight = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * The block height past which a Solana payload's `recentBlockHash` can no
 * longer be included, when the sender recorded it. Undefined for other chains,
 * for Solana payloads built before the field existed, and for a value that
 * does not fit a safe integer, so callers fall back to a conservative bound
 * rather than trust a corrupt one.
 */
export const getKeysignLastValidBlockHeight = (payload: KeysignPayload): number | undefined => {
  // Headless callers (tests, agent tooling) hand in partial payloads with no
  // chain-specific section at all; that is simply "no deadline", not a crash.
  const { blockchainSpecific } = payload
  if (blockchainSpecific?.case !== 'solanaSpecific') return undefined

  const { lastValidBlockHeight } = blockchainSpecific.value
  if (lastValidBlockHeight === undefined || lastValidBlockHeight < 0n || lastValidBlockHeight > maxSafeBlockHeight) {
    return undefined
  }

  return Number(lastValidBlockHeight)
}
