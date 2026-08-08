import type { Envelope as DecodedEnvelope } from '../decode/types'

import type { Envelope as PolicyEnvelope } from './types'

const INTEGER_STRING = /^-?\d+$/

/**
 * Adapts the canonical decoder envelope into the policy/invariant envelope shape.
 *
 * `sdk.decode.fromToolResult()` intentionally preserves raw atomic amounts as
 * strings so the envelope survives JSON round-trips without bigint loss. The
 * policy layer, on the other hand, wants `bigint` for drift checks and balance
 * invariants. Consumers should not have to keep re-implementing the same
 * `{ chain -> chainId, amount string -> bigint }` shim in every app/backend.
 */
export function toPolicyEnvelope(envelope: DecodedEnvelope): PolicyEnvelope {
  const amount = parsePolicyAmount(envelope.amount)
  const invalidAmount = envelope.amount.trim() !== '' && amount === null

  return {
    chainId: envelope.chain,
    recipient: envelope.recipient,
    asset: envelope.asset,
    amount,
    decoded: invalidAmount ? false : envelope.decoded,
    decodeError: invalidAmount
      ? `invalid decoded atomic amount: ${envelope.amount}`
      : envelope.decodeError,
  }
}

function parsePolicyAmount(amount: string): bigint | null {
  const trimmed = amount.trim()
  if (trimmed === '') {
    return null
  }
  if (!INTEGER_STRING.test(trimmed)) {
    return null
  }
  try {
    return BigInt(trimmed)
  } catch {
    return null
  }
}
