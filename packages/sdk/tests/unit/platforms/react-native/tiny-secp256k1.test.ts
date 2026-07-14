import { secp256k1 } from '@noble/curves/secp256k1.js'
import { describe, expect, it } from 'vitest'

import ecc from '@/platforms/react-native/shims/tiny-secp256k1'

const scalar = (value: bigint) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
const EXPECTED_SIGNATURE =
  'd5ebc88d029956fde425fcd18bcd79824ca3d8b1fde30743ec8add79f07abf331d0cbe5f24aac4c3366d72c8f717ff8815fc0074060f168401d7967bbae7a808'
const EXPECTED_HEDGED_SIGNATURE =
  'fef7e4a6eb3deb021586587bb471437913d2de4011c8363a8aad4ad630a7b5837d4fda4f291acae5f7348e8856a2c48d692d6a611a2c7afba65bf2047efb104c'

describe('React Native tiny-secp256k1 shim', () => {
  const privateKey = scalar(1n)
  const tweak = scalar(2n)
  const hash = Uint8Array.from({ length: 32 }, (_, index) => index + 1)

  it('derives and validates compressed and uncompressed points through the Point API', () => {
    const compressed = ecc.pointFromScalar(privateKey, true)
    const uncompressed = ecc.pointFromScalar(privateKey, false)

    expect(compressed).toEqual(secp256k1.Point.BASE.toBytes(true))
    expect(uncompressed).toEqual(secp256k1.Point.BASE.toBytes(false))
    expect(ecc.isPoint(compressed!)).toBe(true)
    expect(ecc.isPoint(Uint8Array.from([1, 2, 3]))).toBe(false)
  })

  it('adds public and private tweaks with the noble curve order', () => {
    const point = ecc.pointFromScalar(privateKey, true)!
    expect(ecc.pointAddScalar(point, tweak, true)).toEqual(
      secp256k1.Point.BASE.add(secp256k1.Point.BASE.multiply(2n)).toBytes(true)
    )
    expect(ecc.privateAdd(privateKey, tweak)).toEqual(scalar(3n))
    expect(ecc.pointAddScalar(point, new Uint8Array(32), true)).toEqual(point)
    expect(ecc.pointFromScalar(Uint8Array.of(1), true)).toBeNull()
    expect(ecc.privateAdd(privateKey, Uint8Array.of(1))).toBeNull()
    expect(ecc.privateAdd(privateKey, scalar(secp256k1.Point.CURVE().n))).toBeNull()
    expect(ecc.isPrivate(privateKey)).toBe(true)
    expect(ecc.isPrivate(new Uint8Array(32))).toBe(false)
  })

  it('returns a compact signature and verifies it', () => {
    const signature = ecc.sign(hash, privateKey)
    const extraData = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    const hedgedSignature = ecc.sign(hash, privateKey, extraData)
    const publicKey = ecc.pointFromScalar(privateKey, true)!

    expect(signature).toHaveLength(64)
    expect(Buffer.from(signature).toString('hex')).toBe(EXPECTED_SIGNATURE)
    expect(Buffer.from(hedgedSignature).toString('hex')).toBe(EXPECTED_HEDGED_SIGNATURE)
    expect(hedgedSignature).not.toEqual(signature)
    expect(ecc.verify(hash, publicKey, signature)).toBe(true)
    expect(
      ecc.verify(
        hash,
        publicKey,
        Uint8Array.from(signature, byte => byte ^ 0xff)
      )
    ).toBe(false)
  })
})
