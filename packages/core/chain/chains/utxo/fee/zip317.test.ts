import { describe, expect, it } from 'vitest'

import { getZcashConventionalFee } from './zip317'

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
