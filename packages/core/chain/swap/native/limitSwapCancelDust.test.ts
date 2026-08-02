import { describe, expect, it } from 'vitest'

import { getLimitSwapCancelDust } from './limitSwapCancelDust'

const inbound = (dust_threshold: string, chain = 'ETH') => ({ chain, dust_threshold })

describe('getLimitSwapCancelDust', () => {
  // ⚠️ The regression this module exists for. A cancel was once signed for
  // 2000 wei — THORChain's 1e8-unit threshold (1000) used verbatim as an
  // 18-decimal chain's smallest unit — which ConvertAmount truncates to zero.
  // Bifrost never saw an inbound, the tx confirmed, gas was burned, and the
  // order carried on resting. The threshold must be rescaled into the coin's
  // own precision first.
  it('rescales an 8-decimal threshold into an 18-decimal chain', () => {
    const dust = getLimitSwapCancelDust({ inbound: inbound('1000'), decimals: 18 })

    // 1000 (1e8) -> 1e13 wei, doubled for the safety margin.
    expect(dust).toBe(2n * 10n ** 13n)
    expect(dust).not.toBe(2000n)
  })

  it('applies the safety multiple on a same-precision chain', () => {
    expect(getLimitSwapCancelDust({ inbound: inbound('10000', 'BTC'), decimals: 8 })).toBe(20_000n)
  })

  it('scales down for a chain coarser than 1e8', () => {
    expect(getLimitSwapCancelDust({ inbound: inbound('1000', 'XRP'), decimals: 6 })).toBe(20n)
  })

  // Refusing beats nudging up to the bare observable minimum: a value landing
  // here means the pipeline that produced it is wrong, and bumping it would be
  // the same silent failure one order of magnitude up.
  it('refuses when the threshold rounds away at the coin precision', () => {
    expect(() => getLimitSwapCancelDust({ inbound: inbound('1', 'X'), decimals: 0 })).toThrow(/rounds away/)
  })

  // dust_threshold is a remote value deciding how much is irreversibly
  // donated, with no refund path.
  it.each([
    ['a missing threshold', ''],
    ['a whitespace threshold', '   '],
    ['a non-integer threshold', '10.5'],
    ['a negative threshold', '-1'],
  ])('refuses %s rather than defaulting', (_label, threshold) => {
    expect(() => getLimitSwapCancelDust({ inbound: inbound(threshold), decimals: 18 })).toThrow()
  })

  it('refuses an unusable precision', () => {
    expect(() => getLimitSwapCancelDust({ inbound: inbound('1000'), decimals: -1 })).toThrow(/precision/)
  })
})
