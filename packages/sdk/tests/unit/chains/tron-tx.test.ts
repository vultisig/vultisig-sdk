/**
 * Unit tests for the hand-rolled Tron protobuf encoder + tx builders.
 *
 * Guards the two high-risk areas:
 *  - `encodeInt64Varint` for negative values (MUST be 10 bytes, two's-complement)
 *  - `buildTronSendTx` / `buildTrc20TransferTx` byte-level shape
 */
import { describe, expect, it } from 'vitest'

import { encodeInt64Varint, encodeVarint } from '../../../src/chains/tron/proto'
import { buildTrc20CallData, buildTrc20TransferTx, buildTronSendTx } from '../../../src/chains/tron/tx'

// Valid Tron base58check addresses (0x41 || 20-byte payload, bs58check-encoded).
const FROM = 'T9yED5xMV5ARV98BexN97aLZ1UUq7eKSxm'
const TO = 'TQcYkNR861VZVLMDfr2RG8CG9bTyDF7jhN'
const USDT = 'TMbLM7XNeQsr3gm8wVYPVcS98WgdYmaVEZ'

const REF_BLOCK_BYTES = new Uint8Array([0x40, 0xdf])
const REF_BLOCK_HASH = new Uint8Array([0xe4, 0xb1, 0x7a, 0x2d, 0x6f, 0x5a, 0x63, 0xbf])

function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0')
  return s
}

describe('tron / encodeVarint', () => {
  it('encodes 0 as a single zero byte', () => {
    expect(bytesToHex(encodeVarint(0))).toBe('00')
  })

  it('encodes 127 as a single byte', () => {
    expect(bytesToHex(encodeVarint(127))).toBe('7f')
  })

  it('encodes 128 as two bytes', () => {
    expect(bytesToHex(encodeVarint(128))).toBe('8001')
  })

  it('rejects negative input', () => {
    expect(() => encodeVarint(-1)).toThrowError()
  })
})

describe('tron / encodeInt64Varint', () => {
  it('matches encodeVarint for non-negative values', () => {
    expect(bytesToHex(encodeInt64Varint(0n))).toBe('00')
    expect(bytesToHex(encodeInt64Varint(1n))).toBe('01')
    expect(bytesToHex(encodeInt64Varint(128n))).toBe('8001')
  })

  it('encodes -1n as 10-byte two-complement varint', () => {
    expect(bytesToHex(encodeInt64Varint(-1n))).toBe('ffffffffffffffffff01')
  })

  it('encodes -2n as 10-byte two-complement varint', () => {
    expect(bytesToHex(encodeInt64Varint(-2n))).toBe('feffffffffffffffff01')
  })

  it('encodes INT64_MIN as 10 bytes with 0x01 trailer', () => {
    const min = -(1n << 63n)
    const enc = encodeInt64Varint(min)
    expect(enc.length).toBe(10)
    expect(enc[9]).toBe(0x01)
  })
})

describe('tron / buildTronSendTx', () => {
  it('produces deterministic raw hex + sha256 signingHash', () => {
    const out = buildTronSendTx({
      from: FROM,
      to: TO,
      amount: 1_500_000n,
      refBlockBytes: REF_BLOCK_BYTES,
      refBlockHash: REF_BLOCK_HASH,
      expiration: 1_700_000_000_000n,
      timestamp: 1_699_999_940_000n,
    })
    expect(out.unsignedRawHex).toMatch(/^[0-9a-f]+$/)
    expect(out.signingHashHex).toMatch(/^[0-9a-f]{64}$/)
    // raw protobuf starts with tag for field 1 (ref_block_bytes): 0x0a
    expect(out.unsignedRawHex.startsWith('0a')).toBe(true)
  })

  it('rejects negative amounts', () => {
    expect(() =>
      buildTronSendTx({
        from: FROM,
        to: TO,
        amount: -1n,
        refBlockBytes: REF_BLOCK_BYTES,
        refBlockHash: REF_BLOCK_HASH,
        expiration: 1n,
        timestamp: 1n,
      })
    ).toThrowError(/non-negative/)
  })

  it('rejects malformed refBlock sizes', () => {
    expect(() =>
      buildTronSendTx({
        from: FROM,
        to: TO,
        amount: 1n,
        refBlockBytes: new Uint8Array([0x01]),
        refBlockHash: REF_BLOCK_HASH,
        expiration: 1n,
        timestamp: 1n,
      })
    ).toThrowError(/refBlockBytes/)
  })

  it('finalize() wraps raw with the 65-byte signature', () => {
    const tx = buildTronSendTx({
      from: FROM,
      to: TO,
      amount: 1n,
      refBlockBytes: REF_BLOCK_BYTES,
      refBlockHash: REF_BLOCK_HASH,
      expiration: 1n,
      timestamp: 1n,
    })
    const sig = '00'.repeat(65)
    const out = tx.finalize(sig)
    // outer tx starts with raw_data tag 0x0a then varint length, then bytes, then 0x12 for signature
    expect(out.signedTxHex.startsWith('0a')).toBe(true)
    expect(out.signedTxHex).toContain('12')
    expect(() => tx.finalize('00'.repeat(64))).toThrowError(/65-byte/)
  })
})

describe('tron / buildTrc20CallData', () => {
  it('produces a 68-byte payload with the correct selector', () => {
    const data = buildTrc20CallData(TO, 1_000_000n)
    expect(data.length).toBe(68)
    expect(bytesToHex(data.subarray(0, 4))).toBe('a9059cbb')
    // Address occupies bytes 16..36 (after 4-byte selector + 12-byte zero pad).
    // The low 20 bytes of the recipient's Tron address are in the tail slot.
    expect(bytesToHex(data.subarray(4, 16))).toBe('00'.repeat(12))
  })
})

describe('tron / buildTrc20TransferTx', () => {
  it('includes the fee_limit field (tag 0x90 0x01)', () => {
    const tx = buildTrc20TransferTx({
      from: FROM,
      to: TO,
      tokenAddress: USDT,
      amount: 123_456n,
      feeLimit: 100_000_000n,
      refBlockBytes: REF_BLOCK_BYTES,
      refBlockHash: REF_BLOCK_HASH,
      expiration: 1_700_000_000_000n,
      timestamp: 1_699_999_940_000n,
    })
    // fee_limit is field 18 (tag = 18<<3 | 0 = 144 = 0x90, encoded as 0x9001).
    expect(tx.unsignedRawHex).toContain('9001')
  })
})
