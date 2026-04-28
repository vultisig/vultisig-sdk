/**
 * Regression test for `buildXrpSendTx().finalize()` accepting 130-hex-char
 * signatures (r || s || recovery_id) returned by the patched `fastVaultSign`.
 *
 * The previous strict check enforced exactly 128 hex chars, so every
 * `build_xrp_send → fastVaultSign → finalize` flow threw at submit time after
 * `fastVaultSign` started appending the recovery byte for ECDSA signatures.
 * XRP's DER encoding ignores the recovery byte; we strip it when present.
 */
import { describe, expect, it } from 'vitest'

import { buildXrpSendTx } from '../../../../src/platforms/react-native/chains/ripple/tx'

// Real well-formed XRP classic addresses (valid base58check). The values below
// are publicly known XRPL accounts — used here only as syntactically valid
// inputs so ripple-binary-codec can serialize the tx.
const COMMON_OPTS = {
  account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  amount: '1000000',
  fee: '12',
  sequence: 1,
  lastLedgerSequence: 100,
  signingPubKey: '03a34f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f3a4f',
}

const R = '8' + 'a'.repeat(63) // 64 hex chars, high bit set so DER prepends 0x00
const S_LOW = '1' + '0'.repeat(63) // 64 hex chars, < HALF_ORDER (no normalization needed)

describe('buildXrpSendTx().finalize — signature length acceptance', () => {
  it('accepts 128-char r||s signature (legacy shape)', () => {
    const { finalize } = buildXrpSendTx(COMMON_OPTS)
    expect(() => finalize(R + S_LOW)).not.toThrow()
    const { signedBlobHex, txHash } = finalize(R + S_LOW)
    expect(signedBlobHex.length).toBeGreaterThan(0)
    expect(txHash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('accepts 130-char r||s||recovery_id signature (fastVaultSign ECDSA shape)', () => {
    const { finalize } = buildXrpSendTx(COMMON_OPTS)
    // Trailing "01" is the recovery byte — XRP ignores it, DER encodes only r||s.
    expect(() => finalize(R + S_LOW + '01')).not.toThrow()
    const { signedBlobHex, txHash } = finalize(R + S_LOW + '01')
    expect(signedBlobHex.length).toBeGreaterThan(0)
    expect(txHash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('produces identical signed blob whether or not recovery byte is appended', () => {
    const { finalize } = buildXrpSendTx(COMMON_OPTS)
    const a = finalize(R + S_LOW)
    const b = finalize(R + S_LOW + '00')
    const c = finalize(R + S_LOW + '03')
    expect(b.signedBlobHex).toBe(a.signedBlobHex)
    expect(c.signedBlobHex).toBe(a.signedBlobHex)
    expect(b.txHash).toBe(a.txHash)
    expect(c.txHash).toBe(a.txHash)
  })

  it('accepts 0x-prefixed 130-char signature', () => {
    const { finalize } = buildXrpSendTx(COMMON_OPTS)
    expect(() => finalize('0x' + R + S_LOW + '01')).not.toThrow()
  })

  it('rejects truncated signatures (length other than 128/130)', () => {
    const { finalize } = buildXrpSendTx(COMMON_OPTS)
    expect(() => finalize(R + S_LOW.slice(0, -2))).toThrow(/expected 128 or 130/)
    expect(() => finalize(R + S_LOW + '0102')).toThrow(/expected 128 or 130/)
    expect(() => finalize('')).toThrow(/expected 128 or 130/)
  })
})
