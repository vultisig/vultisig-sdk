import type { Envelope as DecodedEnvelope } from '../decode/types'
import type { Envelope as PolicyEnvelope } from './types'

// Non-negative only (sdk#1402 review): a negative amount is not a suspicious
// amount that should trip the drift/invariant checks - it's a value those
// checks (envAmount > 0n / envelope.amount > 0n) simply don't gate on, so
// treating "-1000000" as parseable would let a negative Cosmos Coin.amount
// (a raw proto3 string, attacker-shapeable) sail through with the amount
// check silently not running. Reject it as unparseable instead, same as any
// other malformed amount.
const INTEGER_STRING = /^\d+$/

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
  // sdk#1402 review: a non-'transfer' kind (approve/contractCall/delegate/
  // undelegate/unknown) means recipient/asset/amount do NOT represent "who
  // receives what" the way a transfer-intent comparison assumes - an approve
  // has no value recipient (the real counterparty is `spender`), and a
  // contractCall/unknown envelope carries no reliable claim-comparable shape
  // at all. Rebuilding those into a transfer-shaped, decoded:true envelope
  // let an approve/contractCall/unknown tx compare cleanly against a plain-
  // send claim and PASS. Fail closed instead: mark undecoded so the caller
  // gets the existing WARN-on-undecoded fallback (evaluatePolicy.ts /
  // checkInvariants.ts) rather than a false PASS.
  if (envelope.kind !== 'transfer') {
    return {
      chainId: envelope.chain,
      decoded: false,
      decodeError: `envelope kind '${envelope.kind}' is not a transfer - policy comparison is not meaningful for approve/contractCall/delegate/undelegate/unknown effects`,
    }
  }

  // sdk#1402 review: envelope.amount is typed as `string`, but a caller that
  // doesn't (or can't) go through the real decoder - hand-built test fixture,
  // future decoder change, a loosely-typed boundary - can still pass
  // undefined/number/bigint here. `.trim()` on any of those throws, which
  // breaks decode/fromToolResult.ts's own documented contract that this
  // pipeline "never throws - decode failures surface as Envelope{decoded:
  // false, decodeError}". A caller that composes this into a default
  // envelope on catch fails OPEN, not closed.
  if (typeof envelope.amount !== 'string') {
    return {
      chainId: envelope.chain,
      recipient: envelope.recipient,
      asset: envelope.asset,
      amount: null,
      decoded: false,
      decodeError: `envelope.amount is not a string (got ${typeof envelope.amount})`,
    }
  }

  const amount = parsePolicyAmount(envelope.amount)
  const invalidAmount = envelope.amount.trim() !== '' && amount === null

  // sdk#1402 review: an unparseable amount must NOT flip `decoded` to false.
  // `checkInvariants.ts` gates I1/I2/I3/I5/I7 on `decoded === true` and
  // `evaluatePolicy.ts` short-circuits any undecoded envelope to a blanket
  // WARN - flipping the flag here silently erased unrelated, still-valid
  // recipient/chain-mismatch findings whenever the amount string happened to
  // be malformed (e.g. "1e6"), which is exactly the class of bug this
  // envelope shape's own doc comment on `Envelope['amount']` warns against
  // (`amount: null` already means "unknown -> skip the amount check", NOT
  // "the whole envelope is untrustworthy"). Surface the parse failure
  // additively via `amountParseError` instead, and leave decoded/decodeError
  // as the underlying decoder's own (unrelated) status.
  return {
    chainId: envelope.chain,
    recipient: envelope.recipient,
    asset: envelope.asset,
    amount,
    decoded: envelope.decoded,
    decodeError: envelope.decodeError,
    ...(invalidAmount && { amountParseError: `invalid decoded atomic amount: ${envelope.amount}` }),
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
