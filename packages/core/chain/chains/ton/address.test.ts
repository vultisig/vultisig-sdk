import { describe, expect, it } from 'vitest'

import {
  areEqualTonAddresses,
  getTonAddressBounceability,
  tonAddressToBounceable,
  tonAddressToRaw,
} from './address'

// One account in every spelling it has, so a test that claims two forms name the
// same account is actually asserting that and not comparing two accounts.
const bounceable = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const nonBounceable = 'UQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDksXM'
const nonBounceableStandardBase64 = 'UQCIcjES4cQET0z6nRixZ0MdvTB4u3/8triztLSrIIrDksXM'
const testnetBounceable = 'kQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkiOD'
const raw = '0:88723112e1c4044f4cfa9d18b167431dbd3078bb7ffcb6b8b3b4b4ab208ac392'
const otherAccount = 'EQCrq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq8Uk'

describe('tonAddressToRaw', () => {
  it('decodes a user-friendly address to workchain:hex', () => {
    expect(tonAddressToRaw(bounceable)).toBe(raw)
  })
})

describe('tonAddressToBounceable', () => {
  it('normalizes both raw and non-bounceable forms to EQ…', () => {
    expect(tonAddressToBounceable(raw)).toBe(bounceable)
    expect(tonAddressToBounceable(nonBounceable)).toBe(bounceable)
  })
})

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

describe('areEqualTonAddresses', () => {
  it.each([
    ['bounceable vs non-bounceable', bounceable, nonBounceable],
    ['user-friendly vs raw', bounceable, raw],
    ['base64url vs standard base64', nonBounceable, nonBounceableStandardBase64],
    ['surrounding whitespace', bounceable, ` ${bounceable} `],
  ])('treats %s as the same account', (_, left, right) => {
    expect(areEqualTonAddresses(left, right)).toBe(true)
  })

  it('separates two different accounts regardless of form', () => {
    expect(areEqualTonAddresses(bounceable, otherAccount)).toBe(false)
    expect(areEqualTonAddresses(raw, otherAccount)).toBe(false)
  })

  it('falls back to exact comparison for input that is not a TON address, rather than claiming a match', () => {
    expect(areEqualTonAddresses('not-an-address', 'not-an-address')).toBe(true)
    expect(areEqualTonAddresses('not-an-address', bounceable)).toBe(false)
    expect(areEqualTonAddresses('', '')).toBe(true)
  })
})
