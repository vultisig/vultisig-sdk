/**
 * Slots added to the current tip to produce a Cardano transaction's TTL.
 *
 * Cardano slots are 1 second, so this is the window during which a built
 * transaction stays valid; past it the node rejects it outright. Read together
 * with {@link cardanoBroadcastTtlSafetyMargin}: the usable window for a signing
 * ceremony is `cardanoSlotOffset - cardanoBroadcastTtlSafetyMargin` seconds,
 * because broadcast refuses anything closer to expiry than the margin.
 *
 * Do not read this constant directly to build a TTL - call
 * {@link getCardanoSendTtl}, so every consumer applies one policy instead of
 * re-deriving it from the raw number.
 */
export const cardanoSlotOffset = 720

export const cardanoDefaultFee = 180000n

/**
 * How close to its TTL a Cardano transaction may get before broadcast refuses
 * it. Guards against signing a transaction that expires in flight, which would
 * otherwise surface as an opaque node rejection after the ceremony completed.
 */
export const cardanoBroadcastTtlSafetyMargin = 60

/**
 * The canonical TTL for a Cardano transaction built against `currentSlot`.
 *
 * This is protocol policy, not a per-caller choice: a transaction's validity
 * window has to agree across every consumer that builds, signs or broadcasts
 * one. When a consumer re-derives it locally the two silently diverge, and the
 * same send stays valid for a different length of time depending on which code
 * path produced it - while the broadcast-time freshness guard keeps using this
 * side's numbers to judge it.
 *
 * @param currentSlot - the chain tip the transaction is being built against
 */
export const getCardanoSendTtl = (currentSlot: bigint): bigint => currentSlot + BigInt(cardanoSlotOffset)
