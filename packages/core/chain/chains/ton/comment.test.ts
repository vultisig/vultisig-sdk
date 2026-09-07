import { describe, expect, it } from 'vitest'

import {
  getTonCommentMaxBytes,
  getTonJettonCommentMaxBytes,
  tonNativeCommentMaxBytes,
  validateTonComment,
} from './comment'

const jetton = (amount: bigint, isActiveDestination = true) => ({ amount, isActiveDestination })

describe('tonNativeCommentMaxBytes', () => {
  it('is the whole cell minus the comment opcode', () => {
    expect(tonNativeCommentMaxBytes).toBe(123)
  })
})

describe('getTonJettonCommentMaxBytes', () => {
  // The cap is not a constant: `VarUInteger 16` widens a byte at a time, and
  // every byte the amount takes is a byte the comment loses.
  it.each([
    [0n, 42],
    [1n, 41],
    [5_000_000n, 39],
    [10n ** 18n, 34],
    [(1n << 120n) - 1n, 27],
  ])('gives amount %s a %i-byte comment budget', (amount, expected) => {
    expect(getTonJettonCommentMaxBytes(jetton(amount))).toBe(expected)
  })

  it('gains a byte when the destination is inactive, because the forward amount drops to zero', () => {
    expect(getTonJettonCommentMaxBytes(jetton(5_000_000n, false))).toBe(40)
  })

  it('is always far below the native cap — the number a fixed 123 would have allowed', () => {
    expect(getTonJettonCommentMaxBytes(jetton(5_000_000n))).toBeLessThan(tonNativeCommentMaxBytes)
  })
})

describe('getTonCommentMaxBytes', () => {
  it('falls back to the native cap when there is no jetton context', () => {
    expect(getTonCommentMaxBytes({})).toBe(tonNativeCommentMaxBytes)
    expect(getTonCommentMaxBytes({ jetton: jetton(5_000_000n) })).toBe(39)
  })
})

describe('validateTonComment', () => {
  it('accepts a native comment at the cap and rejects one byte more', () => {
    expect(() => validateTonComment({ memo: 'x'.repeat(123) })).not.toThrow()
    expect(() => validateTonComment({ memo: 'x'.repeat(124) })).toThrow(/at most 123 bytes \(got 124\)/)
  })

  it('accepts a jetton comment at the cap and rejects one byte more', () => {
    const context = jetton(5_000_000n)

    expect(() => validateTonComment({ memo: 'x'.repeat(39), jetton: context })).not.toThrow()
    expect(() => validateTonComment({ memo: 'x'.repeat(40), jetton: context })).toThrow(
      /at most 39 bytes for this jetton amount \(got 40\)/
    )
  })

  // The bug this replaces: one fixed 123-byte cap for both paths waved a
  // 40-byte jetton memo through to WalletCore, which answers with a bare
  // "Internal error" once the cell overflows.
  it('rejects a jetton comment that the native cap would have allowed', () => {
    const memo = 'x'.repeat(100)

    expect(() => validateTonComment({ memo })).not.toThrow()
    expect(() => validateTonComment({ memo, jetton: jetton(5_000_000n) })).toThrow(/at most 39 bytes/)
  })

  it('counts UTF-8 bytes, not characters — a multi-byte memo overflows sooner', () => {
    // 40 × 3 bytes = 120 bytes: under the native cap by character count, over it
    // by bytes only for the jetton path.
    expect(() => validateTonComment({ memo: '→'.repeat(40) })).not.toThrow()
    expect(() => validateTonComment({ memo: '→'.repeat(41), jetton: jetton(5_000_000n) })).toThrow(/got 123/)
  })

  it('accepts an empty comment on either path', () => {
    expect(() => validateTonComment({ memo: '' })).not.toThrow()
    expect(() => validateTonComment({ memo: '', jetton: jetton((1n << 120n) - 1n) })).not.toThrow()
  })
})
