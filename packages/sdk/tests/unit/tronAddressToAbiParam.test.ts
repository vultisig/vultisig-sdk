import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { tronAddressToAbiParam } from '@/tools/balance/otherBalance'

// Build a genuinely-valid TRON address (0x41 prefix + 20 bytes) so the test
// owns its vectors instead of relying on a hardcoded mainnet address.
const encode = (bs58check as unknown as { encode: (b: Uint8Array) => string }).encode

const body20 = Buffer.alloc(20, 0xab)
const validAddr = encode(Buffer.concat([Buffer.from([0x41]), body20]))

describe('tronAddressToAbiParam', () => {
  it('decodes a valid base58check address to the left-padded 20-byte word', () => {
    const param = tronAddressToAbiParam(validAddr)
    expect(param).toBe('ab'.repeat(20).padStart(64, '0'))
    expect(param).toHaveLength(64)
  })

  it('rejects an address whose checksum was corrupted (typo near the end)', () => {
    // Flip the final character to a different base58 char — the payload still
    // base58-decodes to 25 bytes with a 0x41 prefix, but the checksum no longer
    // matches. Plain bs58.decode accepted this; bs58check must reject it.
    const last = validAddr.slice(-1)
    const swapped = last === 'A' ? 'B' : 'A'
    const corrupted = validAddr.slice(0, -1) + swapped

    expect(() => tronAddressToAbiParam(corrupted)).toThrow(/checksum mismatch/)
  })

  it('rejects a valid-checksum payload with the wrong version prefix', () => {
    // 0x00 (Bitcoin mainnet) prefix instead of Tron's 0x41 — checksum is valid
    // but it is not a Tron address.
    const notTron = encode(Buffer.concat([Buffer.from([0x00]), body20]))
    expect(() => tronAddressToAbiParam(notTron)).toThrow(/Tron address payload/)
  })
})
