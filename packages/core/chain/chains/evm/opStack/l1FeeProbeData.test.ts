import { hexToBytes, size } from 'viem'
import { describe, expect, it } from 'vitest'

import { l1FeeProbeData } from './l1FeeProbeData'

// FastLZ, which prices the payload from Fjord onwards, encodes a back-reference
// for any window of three bytes it has already seen. A payload that repeats one
// compresses, and the oracle then quotes a fee below what a real transaction
// costs — the exact under-reserve this probe exists to avoid.
const compressibleWindow = 3

const eachWindow = function* (bytes: Uint8Array) {
  for (let i = 0; i + compressibleWindow <= bytes.length; i++) {
    yield bytes.slice(i, i + compressibleWindow).join(',')
  }
}

const distinctWindowRatio = (bytes: Uint8Array) => {
  const windows = [...eachWindow(bytes)]

  return new Set(windows).size / windows.length
}

/** Byte offset at which a three-byte window first repeats, or null if none does. */
const firstRepeatedWindow = (bytes: Uint8Array) => {
  const seen = new Set<string>()
  let offset = 0

  for (const window of eachWindow(bytes)) {
    if (seen.has(window)) return offset
    seen.add(window)
    offset++
  }

  return null
}

// The probe is a 160-byte unsigned-transaction envelope plus the transaction's
// own calldata. The largest calldata this app produces is a swap router call at
// roughly 3 KB, so nothing it builds reaches 3,232 bytes.
const largestProbeCallersBuild = 160 + 3 * 1024

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

  it('repeats no compressible window across any probe its callers can build', () => {
    expect(firstRepeatedWindow(hexToBytes(l1FeeProbeData(largestProbeCallersBuild)))).toBeNull()
  })

  // Pins the headroom above that bound. The birthday bound makes an isolated
  // repeat inevitable in any uniformly distributed byte stream well before 4 KB,
  // so this asserts where the first one falls rather than pretending there is
  // none: a change that moved it below `largestProbeCallersBuild` would be a
  // regression, and one that moved it far above would mean the stream had
  // stopped being uniform.
  it('keeps its first chance repeat clear of that bound', () => {
    const firstRepeat = firstRepeatedWindow(hexToBytes(l1FeeProbeData(1 << 16)))

    expect(firstRepeat).toBeGreaterThan(largestProbeCallersBuild)
    expect(firstRepeat).toBeLessThan(1 << 13)
  })

  // The failure this guards against is a PERIODIC generator: a byte counter
  // wraps every 256 bytes and every window after the first lap is a back
  // reference, so FastLZ compresses the payload away and the oracle stops
  // pricing it by size at all. Isolated chance repeats are a different thing
  // entirely — a lone 3-byte match costs more to encode than it saves, and the
  // live oracles price this stream identically to crypto-random bytes at 1-4 KB
  // and marginally above them at 8-16 KB.
  it('stays aperiodic where a counter would collapse, far beyond any send payload', () => {
    const counter = new Uint8Array(4096).map((_, i) => i % 256)

    expect(distinctWindowRatio(hexToBytes(l1FeeProbeData(4096)))).toBeGreaterThan(0.999)
    expect(distinctWindowRatio(counter)).toBeLessThan(0.07)
  })

  it('treats a negative size as empty rather than throwing', () => {
    expect(l1FeeProbeData(-1)).toBe('0x')
  })
})
