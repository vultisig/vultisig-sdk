import { describe, expect, it } from 'vitest'

import { cardanoBroadcastTtlSafetyMargin, cardanoSlotOffset, getCardanoSendTtl } from './config'

describe('getCardanoSendTtl', () => {
  it('offsets the supplied tip by the canonical slot offset', () => {
    expect(getCardanoSendTtl(0n)).toBe(BigInt(cardanoSlotOffset))
    expect(getCardanoSendTtl(1_000_000n)).toBe(1_000_000n + BigInt(cardanoSlotOffset))
  })

  it('returns a bigint for a bigint tip, so callers never mix number and bigint slots', () => {
    expect(typeof getCardanoSendTtl(123n)).toBe('bigint')
  })

  // The two constants are a pair, not independent knobs. Broadcast refuses any
  // transaction whose TTL is within the safety margin of the current slot, so
  // an offset at or below the margin would build transactions that can never be
  // broadcast at all - valid on paper, rejected in practice.
  it('leaves a usable signing window after the broadcast safety margin', () => {
    expect(cardanoSlotOffset).toBeGreaterThan(cardanoBroadcastTtlSafetyMargin)
    const usableSeconds = cardanoSlotOffset - cardanoBroadcastTtlSafetyMargin
    expect(usableSeconds).toBeGreaterThanOrEqual(600)
  })

  // Pins the policy itself. A consumer that hardcodes its own offset (the app
  // used 7200, a 10x drift) produces sends with a different validity window
  // while the broadcast guard still judges them by the numbers above.
  it('pins the canonical offset so a divergent local copy is a visible change', () => {
    expect(cardanoSlotOffset).toBe(720)
    expect(cardanoBroadcastTtlSafetyMargin).toBe(60)
  })
})
