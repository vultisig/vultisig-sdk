import { describe, expect, it } from 'vitest'

import { getZcashConventionalFee, getZcashOpReturnOutputSize, getZcashTransparentOutputSizes } from './zip317'

const p2pkhOutput = 34n

describe('getZcashConventionalFee', () => {
  it('returns the 10,000 zat floor for a simple 1-in 2-out send', () => {
    expect(
      getZcashConventionalFee({
        inputCount: 1,
        outputSizes: [p2pkhOutput, p2pkhOutput],
      })
    ).toBe(10_000n)
  })

  it('scales with input count beyond the grace window', () => {
    expect(
      getZcashConventionalFee({
        inputCount: 4,
        outputSizes: [p2pkhOutput, p2pkhOutput],
      })
    ).toBe(20_000n)
  })

  it('charges input actions from serialized bytes, not raw count', () => {
    // 75 P2PKH inputs: ceil(75 * 148 / 150) = 74 actions, not 75
    expect(
      getZcashConventionalFee({
        inputCount: 75,
        outputSizes: [p2pkhOutput, p2pkhOutput],
      })
    ).toBe(370_000n)
  })

  it('counts large OP_RETURN outputs as multiple actions', () => {
    // 80-byte memo output: 92 bytes serialized -> with two p2pkh outputs,
    // ceil(160 / 34) = 5 actions -> 25,000 zats
    expect(
      getZcashConventionalFee({
        inputCount: 1,
        outputSizes: [p2pkhOutput, p2pkhOutput, 92n],
      })
    ).toBe(25_000n)
  })
})

describe('getZcashOpReturnOutputSize', () => {
  it('sizes a short memo with a single-byte push (9 + 2 + len)', () => {
    expect(getZcashOpReturnOutputSize('m'.repeat(40))).toBe(51n)
  })

  it('adds a byte of push overhead once the memo exceeds 75 bytes', () => {
    expect(getZcashOpReturnOutputSize('m'.repeat(75))).toBe(86n)
    expect(getZcashOpReturnOutputSize('m'.repeat(76))).toBe(88n)
  })

  it('handles CompactSize and PUSHDATA boundaries for long memos', () => {
    // 250-byte memo: script length 253 crosses the CompactSize 1->3 byte threshold.
    expect(getZcashOpReturnOutputSize('m'.repeat(249))).toBe(261n)
    expect(getZcashOpReturnOutputSize('m'.repeat(250))).toBe(264n)
    // 256-byte memo: push opcode crosses PUSHDATA1 -> PUSHDATA2.
    expect(getZcashOpReturnOutputSize('m'.repeat(255))).toBe(269n)
    expect(getZcashOpReturnOutputSize('m'.repeat(256))).toBe(271n)
  })
})

describe('getZcashTransparentOutputSizes', () => {
  it('returns recipient only when there is no change and no memo', () => {
    expect(getZcashTransparentOutputSizes({ change: 0n, memo: undefined })).toEqual([34n])
  })

  it('adds a change output only when change is positive', () => {
    expect(getZcashTransparentOutputSizes({ change: 1n, memo: undefined })).toEqual([34n, 34n])
  })

  it('appends the OP_RETURN size for a memo send', () => {
    expect(getZcashTransparentOutputSizes({ change: 1n, memo: 'm'.repeat(40) })).toEqual([34n, 34n, 51n])
  })
})
