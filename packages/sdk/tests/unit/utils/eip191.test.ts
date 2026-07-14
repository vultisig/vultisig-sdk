import { hashMessage } from 'viem'
import { describe, expect, it } from 'vitest'

import { computePersonalSignHash, formatEcdsaSignature65 } from '../../../src/utils/eip191'

describe('computePersonalSignHash', () => {
  it.each(['hello world', 'café €', ''])('matches viem for %j', message => {
    expect(`0x${Buffer.from(computePersonalSignHash(message)).toString('hex')}`).toBe(hashMessage(message))
  })
})

describe('formatEcdsaSignature65', () => {
  const r = `f0${'11'.repeat(31)}`
  const s = `02${'22'.repeat(31)}`
  const der = `3045022100${r}0220${s}`

  it('normalizes DER sign padding and appends Ethereum v', () => {
    expect(formatEcdsaSignature65(der, 0)).toBe(`${r}${s}1b`)
    expect(formatEcdsaSignature65(`0x${der}`, 1)).toBe(`${r}${s}1c`)
  })

  it('accepts only an exact 64-byte raw signature', () => {
    const raw = `${'aa'.repeat(32)}${'bb'.repeat(32)}`
    expect(formatEcdsaSignature65(raw, 1)).toBe(`${raw}1c`)
    expect(() => formatEcdsaSignature65(`${raw}00`, 1)).toThrow(/unrecognized format/)
  })

  it.each([
    ['zero r', `${'00'.repeat(32)}${'01'.repeat(32)}`],
    ['zero s', `${'01'.repeat(32)}${'00'.repeat(32)}`],
    ['out-of-range r', `fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141${'01'.repeat(32)}`],
  ])('rejects a raw signature with %s', (_label, signature) => {
    expect(() => formatEcdsaSignature65(signature, 0)).toThrow(/scalar range/)
  })

  it.each([
    ['invalid hex', 'xyz', 0],
    ['invalid recovery id', der, 2],
    ['sequence length mismatch', der.replace('45', '44'), 0],
    ['non-canonical integer padding', `304602220000${r}0220${s}`, 0],
    ['trailing data', `${der}00`, 0],
    ['zero integer', `30250201000220${s}`, 0],
  ])('rejects %s', (_label, signature, recovery) => {
    expect(() => formatEcdsaSignature65(signature as string, recovery as number)).toThrow()
  })
})
