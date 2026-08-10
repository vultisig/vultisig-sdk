import { hexToBytes, size } from 'viem'
import { describe, expect, it } from 'vitest'

import { l1FeeProbeData } from './l1FeeProbeData'

// FastLZ, which prices the payload from Fjord onwards, encodes a back-reference
// for any window of three bytes it has already seen. A payload that repeats one
// compresses, and the oracle then quotes a fee below what a real transaction
// costs — the exact under-reserve this probe exists to avoid.
const compressibleWindow = 3

const distinctWindowRatio = (bytes: Uint8Array) => {
  const windows = bytes.length - compressibleWindow + 1
  const seen = new Set<string>()

  for (let i = 0; i < windows; i++) {
    seen.add(bytes.slice(i, i + compressibleWindow).join(','))
  }

  return seen.size / windows
}

describe('l1FeeProbeData', () => {
  it('produces the requested number of bytes', () => {
    expect(size(l1FeeProbeData(0))).toBe(0)
    expect(size(l1FeeProbeData(160))).toBe(160)
    expect(size(l1FeeProbeData(1024))).toBe(1024)
  })

  it('is deterministic, so the same send reserves the same amount twice running', () => {
    expect(l1FeeProbeData(256)).toBe(l1FeeProbeData(256))
  })

  it('extends rather than reshuffles as the payload grows', () => {
    expect(l1FeeProbeData(512).startsWith(l1FeeProbeData(160))).toBe(true)
  })

  it('repeats no compressible window at the sizes a send actually asks for', () => {
    expect(distinctWindowRatio(hexToBytes(l1FeeProbeData(1024)))).toBe(1)
  })

  // The failure this guards against is a periodic generator: a byte counter
  // wraps every 256 bytes and every window after the first lap is a back
  // reference, so FastLZ compresses the payload away and the oracle quotes a
  // fraction of the real fee. Chance collisions in an aperiodic stream are
  // isolated and cost more to encode than they save.
  it('stays aperiodic where a counter would collapse, far beyond any send payload', () => {
    const counter = new Uint8Array(4096).map((_, i) => i % 256)

    expect(distinctWindowRatio(hexToBytes(l1FeeProbeData(4096)))).toBeGreaterThan(0.999)
    expect(distinctWindowRatio(counter)).toBeLessThan(0.07)
  })

  it('treats a negative size as empty rather than throwing', () => {
    expect(l1FeeProbeData(-1)).toBe('0x')
  })
})
