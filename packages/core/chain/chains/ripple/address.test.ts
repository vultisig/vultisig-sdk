import { describe, expect, it } from 'vitest'

import {
  decodeRippleXAddress,
  encodeRippleXAddress,
  isValidRippleXAddress,
  normalizeRippleDestination,
} from './address'

const classicAddress = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'
const taggedXAddress = 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV'
const untaggedXAddress = 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2gYsjNFQLKYW33DzBm'

describe('Ripple X-addresses', () => {
  it('decodes a known mainnet X-address into its classic address and tag', () => {
    expect(decodeRippleXAddress(taggedXAddress)).toEqual({
      address: classicAddress,
      destinationTag: 495,
    })
  })

  it('round-trips classic addresses with and without a tag', () => {
    expect(encodeRippleXAddress(classicAddress, 495)).toBe(taggedXAddress)
    expect(encodeRippleXAddress(classicAddress)).toBe(untaggedXAddress)
    expect(normalizeRippleDestination(untaggedXAddress)).toEqual({
      address: classicAddress,
      destinationTag: undefined,
    })
  })

  it('rejects tag-zero and malformed X-addresses', () => {
    const tagZero = 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2m4Er6SnvjVLpMWPjR'
    const testnet = 'TVd2rqMkYL2AyS97NdELcpeiprNBjwVu8XCE7W73WEvzcB1'

    expect(isValidRippleXAddress(tagZero)).toBe(false)
    expect(isValidRippleXAddress(testnet)).toBe(false)
    expect(isValidRippleXAddress('X-not-valid')).toBe(false)
  })
})
