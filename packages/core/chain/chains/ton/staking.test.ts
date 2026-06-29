import { describe, expect, it } from 'vitest'

import { tonAddressToBounceable, tonAddressToRaw } from './address'
import {
  isStakeableTonPool,
  isTonNominatorImplementation,
  isTonStakingComment,
  tonPoolHasCapacity,
  tonStakingDepositComment,
  TonStakingPool,
  tonStakingWithdrawComment,
} from './staking'

const basePool: TonStakingPool = {
  address: '0:abc',
  name: 'Pool',
  apy: 5,
  minStake: 50_000_000_000n,
  verified: true,
  currentNominators: 10,
  maxNominators: 40,
  implementation: 'whales',
}

describe('TON staking comments', () => {
  it('maps deposit comments per implementation', () => {
    expect(tonStakingDepositComment('whales')).toBe('Deposit')
    expect(tonStakingDepositComment('tf')).toBe('d')
  })

  it('maps withdraw comments per implementation', () => {
    expect(tonStakingWithdrawComment('whales')).toBe('Withdraw')
    expect(tonStakingWithdrawComment('tf')).toBe('w')
  })

  it('returns undefined for unsupported / unknown implementations', () => {
    expect(tonStakingDepositComment('liquidTF')).toBeUndefined()
    expect(tonStakingWithdrawComment('liquidTF')).toBeUndefined()
    expect(tonStakingDepositComment(undefined)).toBeUndefined()
    expect(tonStakingDepositComment('something-new')).toBeUndefined()
  })

  it('recognises all four staking comments (for the bounceable-send guard)', () => {
    for (const memo of ['d', 'w', 'Deposit', 'Withdraw']) {
      expect(isTonStakingComment(memo)).toBe(true)
    }
    expect(isTonStakingComment(' Deposit ')).toBe(true)
    expect(isTonStakingComment('Stake')).toBe(false)
    expect(isTonStakingComment('gm')).toBe(false)
    expect(isTonStakingComment(undefined)).toBe(false)
  })
})

describe('TON nominator pool eligibility', () => {
  it('recognises only whales and tf as nominator implementations', () => {
    expect(isTonNominatorImplementation('whales')).toBe(true)
    expect(isTonNominatorImplementation('tf')).toBe(true)
    expect(isTonNominatorImplementation('liquidTF')).toBe(false)
    expect(isTonNominatorImplementation(undefined)).toBe(false)
  })

  it('treats missing/zero max nominators as having capacity', () => {
    expect(tonPoolHasCapacity({ ...basePool, currentNominators: undefined })).toBe(true)
    expect(tonPoolHasCapacity({ ...basePool, maxNominators: 0 })).toBe(true)
  })

  it('reports no capacity when full', () => {
    expect(
      tonPoolHasCapacity({
        ...basePool,
        currentNominators: 40,
        maxNominators: 40,
      })
    ).toBe(false)
  })

  it('is stakeable only when verified, nominator, and with capacity', () => {
    expect(isStakeableTonPool(basePool)).toBe(true)
    expect(isStakeableTonPool({ ...basePool, verified: false })).toBe(false)
    expect(isStakeableTonPool({ ...basePool, implementation: 'liquidTF' })).toBe(false)
    expect(
      isStakeableTonPool({
        ...basePool,
        currentNominators: 40,
        maxNominators: 40,
      })
    ).toBe(false)
  })
})

describe('tonAddressToBounceable', () => {
  it('round-trips an EQ address through raw back to bounceable EQ', () => {
    const friendly = 'EQDAFuDWly4z3eA16Ej_JHpoL6CcXdt0IRUrODKKsu60HYMi'
    const raw = tonAddressToRaw(friendly)

    expect(raw.startsWith('0:')).toBe(true)
    expect(tonAddressToBounceable(raw)).toBe(friendly)
  })

  it('re-encodes an already user-friendly address as bounceable', () => {
    const friendly = 'EQDAFuDWly4z3eA16Ej_JHpoL6CcXdt0IRUrODKKsu60HYMi'

    expect(tonAddressToBounceable(friendly)).toBe(friendly)
  })
})
