import { describe, expect, it } from 'vitest'

import { resolvedMaxAmount } from './transaction'

// bead vultisig-2lnf8: send --max previously echoed the literal 'max' string
// in the dry-run response's `amount` field. The helper below rehydrates the
// resolved value from what the SDK already returned (dryResult.total and .fee),
// which is what previewDryRun now passes to `amount`. These cases pin the
// arithmetic across the two SDK shapes (native vs token) and across decimal
// widths from 6 (cosmos) to 18 (EVM).
describe('resolvedMaxAmount', () => {
  it('token send: passes total through unchanged (fee is in a different token)', () => {
    // For a token max, VaultBase.ts:1782 isTokenSend branch sets total = amountBigInt
    // (i.e. total IS the amount; fee is paid in the native gas token separately).
    expect(resolvedMaxAmount(true, '1.234567', '0.000021')).toBe('1.234567')
    expect(resolvedMaxAmount(true, '1000', '5.5')).toBe('1000')
    expect(resolvedMaxAmount(true, '0.5', '0.00001')).toBe('0.5')
  })

  it('native send: subtracts fee from total via BigInt-scaled arithmetic', () => {
    // Native max: SDK returns total = amountBigInt + fee, so amount = total - fee.
    // EVM-scale (18 decimals). Confirmed against the actual repro:
    // send ethereum <addr> --max --dry-run → total='0.003973219149949019', fee='0.000025698195113'
    expect(resolvedMaxAmount(false, '0.003973219149949019', '0.000025698195113')).toBe('0.003947520954836019')
    // BTC-scale (8 decimals)
    expect(resolvedMaxAmount(false, '0.001', '0.0001')).toBe('0.0009')
    // ATOM-scale (6 decimals)
    expect(resolvedMaxAmount(false, '1.234567', '0.0075')).toBe('1.227067')
  })

  it('native send: handles when fee > total (edge case, returns 0 instead of negative)', () => {
    // Should not happen in practice — SDK throws 'Insufficient balance to cover
    // network fees' when maxSendable <= 0 (VaultBase.ts:1752). Belt-and-suspenders
    // defense that the display helper never emits a negative amount to the user.
    expect(resolvedMaxAmount(false, '0.001', '0.002')).toBe('0')
    expect(resolvedMaxAmount(false, '0.0001', '0.0001')).toBe('0')
  })

  it('native send: integer-only inputs (no decimal point)', () => {
    expect(resolvedMaxAmount(false, '100', '2')).toBe('98')
    expect(resolvedMaxAmount(false, '1000', '0')).toBe('1000')
  })

  it('trims trailing zeros in the resolved fraction', () => {
    // 1.5 - 0.5 = 1.0 (no trailing zeros in display)
    expect(resolvedMaxAmount(false, '1.5', '0.5')).toBe('1')
    // 0.100 - 0.050 = 0.050 → '0.05' (trailing zero trimmed)
    expect(resolvedMaxAmount(false, '0.100', '0.050')).toBe('0.05')
  })
})
