import { describe, expect, it } from 'vitest'

import { assertLimitSwapMemo, parseLimitSwapMemo } from './limitSwapMemo'

const validMemo = '=<:ETH.ETH:0x742d35Cc6634C0532925a3b844Bc454e4438f44e:1600000000/14400/0'
const validWithAffiliate = `${validMemo}:v0:50`

describe('assertLimitSwapMemo', () => {
  it.each([validMemo, validWithAffiliate])('accepts a well-formed memo (%s)', memo => {
    expect(() => assertLimitSwapMemo(memo)).not.toThrow()
  })

  it.each([
    ['a market swap', '=>:ETH.ETH:0xdest:100/1/0'],
    ['an LP add', '+:BTC.BTC'],
    ['empty', ''],
  ])('rejects %s memo', (_, memo) => {
    expect(() => assertLimitSwapMemo(memo)).toThrow(/not a THORChain limit-swap memo/)
  })

  // A prefix-only check would let these through to a signer.
  it('rejects a memo whose trade target is not limit-shaped', () => {
    expect(() => assertLimitSwapMemo('=<:BTC.BTC:destination:not-a-limit')).toThrow(/trade target must be/)
  })

  it.each([
    ['too few', '=<:ETH.ETH:0xdest'],
    ['too many', '=<:ETH.ETH:0xdest:1/2/0:v0:50:extra'],
  ])('rejects a memo with %s segments', (_, memo) => {
    expect(() => assertLimitSwapMemo(memo)).toThrow(/must have 3 segments/)
  })

  it('rejects a missing target asset', () => {
    expect(() => assertLimitSwapMemo('=<::0xdest:100/14400/0')).toThrow(/missing its target asset/)
  })

  it('rejects a missing destination address', () => {
    expect(() => assertLimitSwapMemo('=<:ETH.ETH::100/14400/0')).toThrow(/missing its destination address/)
  })

  // THORChain reads a zero trade target as an unprotected market order.
  it('rejects a zero minimum-received', () => {
    expect(() => assertLimitSwapMemo('=<:ETH.ETH:0xdest:0/14400/0')).toThrow(/zero minimum-received/)
  })

  it('rejects a non-integer affiliate bps', () => {
    expect(() => assertLimitSwapMemo(`${validMemo}:v0:half`)).toThrow(/affiliate bps must be an integer/)
  })

  it('rejects an empty affiliate name', () => {
    expect(() => assertLimitSwapMemo(`${validMemo}::50`)).toThrow(/empty affiliate segment/)
  })
})

// assertLimitSwapMemo delegates here, so every rejection above is this parser's
// too. These cover what it *returns* — the terms a joining device reviews.
describe('parseLimitSwapMemo', () => {
  it('returns the order terms without an affiliate', () => {
    expect(parseLimitSwapMemo(validMemo)).toEqual({
      targetAsset: 'ETH.ETH',
      destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      limit: 1_600_000_000n,
      intervalBlocks: 14_400,
      quantity: 0,
    })
  })

  it('returns the affiliate terms when present', () => {
    expect(parseLimitSwapMemo(validWithAffiliate)).toMatchObject({
      affiliate: 'v0',
      affiliateBps: 50,
    })
  })

  // The LIM is the order's price floor; a Number round-trip would lose precision
  // above 2^53, which is reachable for an 18-decimal target.
  it('keeps the LIM as a bigint', () => {
    const big = '=<:ETH.ETH:0x742d35Cc6634C0532925a3b844Bc454e4438f44e:99999999999999999999/14400/0'

    expect(parseLimitSwapMemo(big).limit).toBe(99_999_999_999_999_999_999n)
  })

  it('round-trips the memo it was given', () => {
    const { targetAsset, destinationAddress, limit, intervalBlocks, quantity } = parseLimitSwapMemo(validMemo)

    expect(`=<:${targetAsset}:${destinationAddress}:${limit}/${intervalBlocks}/${quantity}`).toBe(validMemo)
  })
})

