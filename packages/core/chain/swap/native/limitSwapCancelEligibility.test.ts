import { describe, expect, it } from 'vitest'

import {
  getLimitSwapCancelEligibility,
  LimitSwapCancelCandidate,
  resolveLimitSwapCancelAsset,
} from './limitSwapCancelEligibility'

const fullUsdc = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'

const candidate = (overrides: Partial<LimitSwapCancelCandidate> = {}): LimitSwapCancelCandidate => ({
  isTerminal: false,
  sourceAsset: 'THOR.RUNE',
  targetAsset: fullUsdc,
  signedSourceAmount: 100_000_000n,
  signedTradeTarget: 43_079_145n,
  ...overrides,
})

const blockerOf = (c: LimitSwapCancelCandidate) => {
  const result = getLimitSwapCancelEligibility(c)
  return 'blocked' in result ? result.blocked : null
}

describe('resolveLimitSwapCancelAsset', () => {
  it('prefers the locally signed full form', () => {
    expect(resolveLimitSwapCancelAsset({ stored: 'ETH.USDC-06EB48', signed: fullUsdc })).toEqual({ resolved: fullUsdc })
  })

  // The placement spelling is lossy — an abbreviation cannot be expanded back.
  it('refuses to fall back to an abbreviated stored spelling', () => {
    expect(resolveLimitSwapCancelAsset({ stored: 'ETH.USDC-06EB48' })).toEqual({
      problem: 'unknown',
    })
  })

  // Native and secured-native legs carry no identifier, so they are full.
  it('accepts a stored spelling that carries no identifier', () => {
    expect(resolveLimitSwapCancelAsset({ stored: 'BTC.BTC' })).toEqual({ resolved: 'BTC.BTC' })
  })

  // The legacy case: nothing local, rescued by the only source still holding
  // the full contract.
  it('falls back to the chain report when no local spelling is usable', () => {
    expect(resolveLimitSwapCancelAsset({ stored: 'ETH.USDC-06EB48', observed: fullUsdc })).toEqual({
      resolved: fullUsdc,
    })
  })

  // Case differs by convention between the two sources; anything beyond it is
  // a real difference.
  it('treats a case-only difference as agreement', () => {
    expect(
      resolveLimitSwapCancelAsset({
        stored: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        observed: 'ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      })
    ).toEqual({ resolved: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' })
  })

  it('reports a genuine disagreement', () => {
    expect(resolveLimitSwapCancelAsset({ stored: 'BTC.BTC', observed: 'ETH.ETH' })).toEqual({ problem: 'disagrees' })
  })
})

describe('getLimitSwapCancelEligibility', () => {
  it('yields the exact inputs for a cancellable order', () => {
    expect(getLimitSwapCancelEligibility(candidate())).toEqual({
      cancellable: {
        sourceAsset: 'THOR.RUNE',
        sourceAmount: 100_000_000n,
        targetAsset: fullUsdc,
        tradeTarget: 43_079_145n,
      },
    })
  })

  it.each([
    ['a terminal order', { isTerminal: true }, 'terminal'],
    ['a cancel already broadcast', { hasPendingCancel: true }, 'cancelAlreadyBroadcast'],
    ['a missing source amount', { signedSourceAmount: undefined }, 'missingSignedData'],
    ['a zero trade target', { signedTradeTarget: 0n }, 'missingSignedData'],
    ['an unresolvable asset', { targetAsset: 'ETH.USDC-06EB48' }, 'missingSignedData'],
  ] as const)('blocks %s', (_label, overrides, expected) => {
    expect(blockerOf(candidate(overrides))).toBe(expected)
  })

  // The amounts feed the ratio the matcher keys on; drift lands in a different
  // bucket and the cancel silently matches nothing.
  it.each([
    ['deposit', { observedDeposit: 99_999_999n }],
    ['trade target', { observedTradeTarget: 1n }],
  ])('blocks when the observed %s disagrees', (_label, overrides) => {
    expect(blockerOf(candidate(overrides))).toBe('signedDataDisagreesWithChain')
  })

  // The check a real failure needed: the amounts were compared and agreed, the
  // assets were never compared, and the asset was the entire defect.
  it('blocks when an observed ASSET disagrees, even though the amounts match', () => {
    expect(
      blockerOf(
        candidate({
          observedDeposit: 100_000_000n,
          observedTradeTarget: 43_079_145n,
          observedSourceAsset: 'BTC.BTC',
        })
      )
    ).toBe('signedDataDisagreesWithChain')
  })

  // An order placed seconds ago has not been polled; refusing until the first
  // poll lands would be a worse failure than the one this prevents.
  it('allows a cancel before the first poll has observed anything', () => {
    expect(blockerOf(candidate())).toBeNull()
  })

  it('allows a cancel when observations agree', () => {
    expect(
      blockerOf(
        candidate({
          observedDeposit: 100_000_000n,
          observedTradeTarget: 43_079_145n,
          observedSourceAsset: 'THOR.RUNE',
          observedTargetAsset: fullUsdc,
        })
      )
    ).toBeNull()
  })

  // Nothing in a cancel memo can be shortened, so the order refunds at expiry.
  it('blocks a full-contract target from a UTXO source', () => {
    expect(blockerOf(candidate({ sourceAsset: 'BTC.BTC', targetAsset: fullUsdc }))).toBe('memoTooLongForSourceChain')
  })
})
