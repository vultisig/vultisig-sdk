import { secp256k1 } from '@noble/curves/secp256k1.js'
import { describe, expect, it } from 'vitest'

import { encodeDERSignature } from './derSignature'

const hex = (value: string) => Buffer.from(value, 'hex')
const encode = (r: string, s: string) => Buffer.from(encodeDERSignature(hex(r), hex(s))).toString('hex')

describe('encodeDERSignature', () => {
  // Zcash tx 6ee6f4e001d83db3ec348c2d857ee60bac130a130e9ccdccfc0d9e7ddb08cecd input 1, as broadcast by Android.
  it('drops a leading zero byte of r, matching the signature accepted on-chain', () => {
    expect(
      encode(
        '007aeb956e43b493d241249db26530ea4593d5a0c22f247f391289c95b1f19eb',
        '72f64b8f0fd4d4d25563c30ec6f549df5e7fe8356e09bb731a61ded1c5a4d4cb'
      )
    ).toBe(
      '3043021f7aeb956e43b493d241249db26530ea4593d5a0c22f247f391289c95b1f19eb022072f64b8f0fd4d4d25563c30ec6f549df5e7fe8356e09bb731a61ded1c5a4d4cb'
    )
  })

  it('matches a strict DER encoder for values with leading zero bytes and high bits', () => {
    const prefixes = ['00', '0000', '0080', '00ff', '7f', '80', 'ff']
    for (const rPrefix of prefixes) {
      for (const sPrefix of prefixes) {
        const r = rPrefix + '11'.repeat(32 - rPrefix.length / 2)
        const s = sPrefix + '22'.repeat(32 - sPrefix.length / 2)
        const expected = Buffer.from(secp256k1.Signature.fromHex(r + s, 'compact').toBytes('der')).toString('hex')
        expect(encode(r, s), `r=${rPrefix}… s=${sPrefix}…`).toBe(expected)
      }
    }
  })
})
