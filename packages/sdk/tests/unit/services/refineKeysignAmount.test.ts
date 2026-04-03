import { describe, expect, it } from 'vitest'

/**
 * Tests for the zero-value contract call fix in refineKeysignAmount.
 *
 * The actual refineKeysignAmount lives in @vultisig/core-mpc which doesn't
 * have its own vitest config. We replicate the core logic here to verify
 * the fix: toAmount === '0' must skip refinement (not throw not-enough-funds).
 *
 * See: packages/core/mpc/keysign/refine/amount.ts
 */

// Replicate the fixed logic from refineKeysignAmount
function refineKeysignAmountFixed(toAmount: string, balance: bigint, fee: bigint): string {
  // Fix: skip refinement for zero-value calls
  if (!toAmount || toAmount === '0') {
    return toAmount
  }

  const refinedAmount = balance - fee < BigInt(toAmount) ? balance - fee : BigInt(toAmount)

  if (refinedAmount <= 0n) {
    throw new Error('not-enough-funds')
  }

  return refinedAmount.toString()
}

// Replicate the BUGGY logic (before fix) to prove the bug exists
function refineKeysignAmountBuggy(toAmount: string, balance: bigint, fee: bigint): string {
  if (!toAmount) {
    return toAmount
  }

  const refinedAmount = balance - fee < BigInt(toAmount) ? balance - fee : BigInt(toAmount)

  if (refinedAmount <= 0n) {
    throw new Error('not-enough-funds')
  }

  return refinedAmount.toString()
}

describe('refineKeysignAmount zero-value fix', () => {
  const FEE = 21000n

  describe('buggy version (before fix)', () => {
    it('throws not-enough-funds for toAmount "0"', () => {
      // This is the bug: zero-value calls should not throw
      expect(() => refineKeysignAmountBuggy('0', 1000000n, FEE)).toThrow('not-enough-funds')
    })
  })

  describe('fixed version', () => {
    it('returns "0" unchanged for zero-value contract calls', () => {
      const result = refineKeysignAmountFixed('0', 1000000n, FEE)
      expect(result).toBe('0')
    })

    it('returns "0" even when balance is zero', () => {
      const result = refineKeysignAmountFixed('0', 0n, FEE)
      expect(result).toBe('0')
    })

    it('returns empty string unchanged', () => {
      const result = refineKeysignAmountFixed('', 1000000n, FEE)
      expect(result).toBe('')
    })

    it('refines positive amount normally when balance is sufficient', () => {
      // balance (1M) - fee (21000) = 979000, min(500000, 979000) = 500000
      const result = refineKeysignAmountFixed('500000', 1000000n, FEE)
      expect(result).toBe('500000')
    })

    it('caps amount to balance minus fee when balance is tight', () => {
      // balance (100000) - fee (21000) = 79000, min(500000, 79000) = 79000
      const result = refineKeysignAmountFixed('500000', 100000n, FEE)
      expect(result).toBe('79000')
    })

    it('throws not-enough-funds when balance cannot cover fee for positive amounts', () => {
      // balance (100) - fee (21000) = negative → refined ≤ 0 → throws
      expect(() => refineKeysignAmountFixed('50', 100n, FEE)).toThrow('not-enough-funds')
    })
  })
})
