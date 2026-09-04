import { describe, expect, it } from 'vitest'

import { getTonAddressBounceability, tonAddressToBounceable } from './address'

const bounceable = 'EQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISJrE'
const nonBounceable = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const raw = '0:e62deead89c718fee2d9b1fbab75838db2136e0a7f084bcd4a709f29e8ce8848'
const testnetBounceable = 'kQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISCFO'

describe('getTonAddressBounceability', () => {
  it('reads the tag of a user-friendly address', () => {
    expect(getTonAddressBounceability(bounceable)).toBe('bounceable')
    expect(getTonAddressBounceability(nonBounceable)).toBe('nonBounceable')
  })

  it('reads the tag on testnet-flagged addresses too', () => {
    expect(getTonAddressBounceability(testnetBounceable)).toBe('bounceable')
  })

  // The three forms below all start with a character a prefix check would read as
  // meaningful, and none of them actually declares a bounce flag.
  it('reports raw addresses as unspecified — they carry no tag at all', () => {
    expect(getTonAddressBounceability(raw)).toBe('unspecified')
  })

  it('reports a corrupted address as unspecified rather than trusting its tag', () => {
    const corrupted = `${bounceable.slice(0, -1)}${bounceable.endsWith('A') ? 'B' : 'A'}`

    expect(getTonAddressBounceability(corrupted)).toBe('unspecified')
  })

  it('reports garbage as unspecified instead of throwing', () => {
    expect(getTonAddressBounceability('EQdest')).toBe('unspecified')
    expect(getTonAddressBounceability('')).toBe('unspecified')
  })

  it('agrees with the form tonAddressToBounceable produces', () => {
    expect(getTonAddressBounceability(tonAddressToBounceable(raw))).toBe('bounceable')
    expect(getTonAddressBounceability(tonAddressToBounceable(nonBounceable))).toBe('bounceable')
  })
})
