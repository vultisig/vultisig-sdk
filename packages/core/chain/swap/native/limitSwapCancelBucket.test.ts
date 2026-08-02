import { describe, expect, it } from 'vitest'

import {
  areLimitOrdersCancelIndistinguishable,
  getThorchainLimitOrderBucketKey,
  toThorchainLayer1MemoAsset,
} from './limitSwapCancelBucket'

const order = (sourceAmount: bigint, tradeTarget: bigint, overrides = {}) => ({
  sourceAsset: 'THOR.RUNE',
  targetAsset: 'BTC.BTC',
  sourceAmount,
  tradeTarget,
  ...overrides,
})

describe('toThorchainLayer1MemoAsset', () => {
  it.each([
    // Already L1: the `-` in a contract suffix comes AFTER the `.`, so it must
    // not be touched.
    ['ETH.USDC-0XA0B8', 'ETH.USDC-0XA0B8'],
    ['BTC.BTC', 'BTC.BTC'],
    // The first separator becomes `.`, and secured denoms arrive lower-case.
    ['eth-usdc-0xa0b8', 'ETH.USDC-0XA0B8'],
    ['btc-btc', 'BTC.BTC'],
    ['BTC/BTC', 'BTC.BTC'],
    ['BTC~BTC', 'BTC.BTC'],
  ])('collapses %s to %s', (asset, expected) => {
    expect(toThorchainLayer1MemoAsset(asset)).toBe(expected)
  })
})

describe('getThorchainLimitOrderBucketKey', () => {
  // ratio = (sourceAmount * 1e8) / tradeTarget, zero-padded to 18 chars.
  it('builds the key from the ratio, zero-padded', () => {
    expect(getThorchainLimitOrderBucketKey(order(100_000_000n, 100_000_000n))).toBe(
      'THOR.RUNE>BTC.BTC/000000000100000000/'
    )
  })

  // THORNode truncates from the right, deliberately collapsing very large
  // ratios into one bucket. Reproducing only the padding would disagree with
  // the chain at exactly the extreme where it matters.
  it('truncates an over-long ratio rather than keeping it', () => {
    const key = getThorchainLimitOrderBucketKey(order(10n ** 20n, 1n))
    const ratio = key.split('/')[1]

    expect(ratio).toHaveLength(18)
    expect(ratio).toBe('100000000000000000')
  })

  // A secured representation and the plain L1 asset collapse to the same key
  // on-chain, so a verbatim string comparison would miss a real collision.
  it('treats a secured leg as its layer-1 asset', () => {
    expect(getThorchainLimitOrderBucketKey(order(1_000n, 1_000n, { sourceAsset: 'thor-rune' }))).toBe(
      getThorchainLimitOrderBucketKey(order(1_000n, 1_000n))
    )
  })
})

describe('areLimitOrdersCancelIndistinguishable', () => {
  // Selling 1 and selling 2 at the same price land in one bucket. Comparing
  // amounts for equality would under-report exactly the duplicates that matter.
  it('collides on equal ratio despite different amounts', () => {
    expect(
      areLimitOrdersCancelIndistinguishable(order(100_000_000n, 50_000_000n), order(200_000_000n, 100_000_000n))
    ).toBe(true)
  })

  it('separates orders at different prices', () => {
    expect(
      areLimitOrdersCancelIndistinguishable(order(100_000_000n, 50_000_000n), order(100_000_000n, 25_000_000n))
    ).toBe(false)
  })

  it('separates orders on different pairs', () => {
    expect(
      areLimitOrdersCancelIndistinguishable(order(100n, 100n), order(100n, 100n, { targetAsset: 'ETH.ETH' }))
    ).toBe(false)
  })
})
