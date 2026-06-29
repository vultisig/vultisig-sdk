import { describe, expect, it } from 'vitest'

import { solanaStakingConfig } from '../config'
import { isDeactivationSentinel, parseStakeAccount, SolanaStakeAccount, stakeActivationState } from './stakeAccount'

const sentinel = solanaStakingConfig.epochSentinel

const parsedInfo = (overrides?: {
  deactivationEpoch?: string
  activationEpoch?: string
  withDelegation?: boolean
}) => ({
  meta: {
    rentExemptReserve: '2282880',
    authorized: { staker: 'STAKER_PUBKEY', withdrawer: 'WITHDRAWER_PUBKEY' },
  },
  stake:
    overrides?.withDelegation === false
      ? undefined
      : {
          delegation: {
            voter: 'VOTE_PUBKEY',
            stake: '5000000000',
            activationEpoch: overrides?.activationEpoch ?? '100',
            deactivationEpoch: overrides?.deactivationEpoch ?? sentinel.toString(),
          },
        },
})

describe('parseStakeAccount', () => {
  it('parses a delegated jsonParsed account, converting u64 strings to bigint', () => {
    const account = parseStakeAccount({
      pubkey: 'STAKE_ACCT',
      lamports: 5_002_282_880n,
      parsedInfo: parsedInfo(),
    })
    expect(account).toEqual<SolanaStakeAccount>({
      pubkey: 'STAKE_ACCT',
      lamports: 5_002_282_880n,
      rentExemptReserve: 2_282_880n,
      staker: 'STAKER_PUBKEY',
      withdrawer: 'WITHDRAWER_PUBKEY',
      delegation: {
        votePubkey: 'VOTE_PUBKEY',
        activationEpoch: 100n,
        deactivationEpoch: sentinel,
        stake: 5_000_000_000n,
      },
    })
  })

  it('parses an initialized-but-undelegated account (no delegation)', () => {
    const account = parseStakeAccount({
      pubkey: 'STAKE_ACCT',
      lamports: 2_282_880n,
      parsedInfo: parsedInfo({ withDelegation: false }),
    })
    expect(account?.delegation).toBeUndefined()
    expect(account?.rentExemptReserve).toBe(2_282_880n)
  })

  it('returns undefined when the account is not a parsed stake account', () => {
    expect(parseStakeAccount({ pubkey: 'X', lamports: 0n, parsedInfo: undefined })).toBeUndefined()
  })

  it('rejects a row with a missing authority instead of fabricating an empty one', () => {
    expect(
      parseStakeAccount({
        pubkey: 'X',
        lamports: 1n,
        parsedInfo: {
          meta: {
            rentExemptReserve: '2282880',
            authorized: { staker: 'STAKER_PUBKEY' },
          },
        },
      })
    ).toBeUndefined()
  })

  it('rejects a delegation object missing its voter instead of treating it as undelegated', () => {
    expect(
      parseStakeAccount({
        pubkey: 'X',
        lamports: 1n,
        parsedInfo: {
          meta: {
            rentExemptReserve: '2282880',
            authorized: { staker: 'STAKER_PUBKEY', withdrawer: 'WITHDRAWER_PUBKEY' },
          },
          stake: {
            delegation: {
              stake: '5000000000',
              activationEpoch: '100',
              deactivationEpoch: sentinel.toString(),
            },
          },
        },
      })
    ).toBeUndefined()
  })

  it('rejects a delegation with an unparseable numeric field instead of coercing it to 0n', () => {
    expect(
      parseStakeAccount({
        pubkey: 'X',
        lamports: 1n,
        parsedInfo: {
          meta: {
            rentExemptReserve: '2282880',
            authorized: { staker: 'STAKER_PUBKEY', withdrawer: 'WITHDRAWER_PUBKEY' },
          },
          stake: {
            delegation: {
              voter: 'VOTE_PUBKEY',
              stake: 'not-a-number',
              activationEpoch: '100',
              deactivationEpoch: sentinel.toString(),
            },
          },
        },
      })
    ).toBeUndefined()
  })
})

describe('isDeactivationSentinel', () => {
  it('is true for the u64::MAX sentinel and false otherwise', () => {
    expect(
      isDeactivationSentinel({
        votePubkey: 'v',
        activationEpoch: 1n,
        deactivationEpoch: sentinel,
        stake: 1n,
      })
    ).toBe(true)
    expect(
      isDeactivationSentinel({
        votePubkey: 'v',
        activationEpoch: 1n,
        deactivationEpoch: 200n,
        stake: 1n,
      })
    ).toBe(false)
  })
})

describe('stakeActivationState', () => {
  const account = (delegation: SolanaStakeAccount['delegation']): SolanaStakeAccount => ({
    pubkey: 'S',
    lamports: 1n,
    rentExemptReserve: 0n,
    staker: 's',
    withdrawer: 'w',
    delegation,
  })

  it('is inactive with no delegation', () => {
    expect(stakeActivationState(account(undefined), 100n)).toBe('inactive')
  })

  it('is activating in the delegation epoch (not deactivating)', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: sentinel,
      stake: 1n,
    })
    expect(stakeActivationState(a, 100n)).toBe('activating')
  })

  it('is active after the activation epoch (not deactivating)', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: sentinel,
      stake: 1n,
    })
    expect(stakeActivationState(a, 101n)).toBe('active')
  })

  it('is deactivating until the current epoch passes the deactivation epoch', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: 200n,
      stake: 1n,
    })
    expect(stakeActivationState(a, 200n)).toBe('deactivating')
  })

  it('is inactive once the deactivation epoch has passed', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: 200n,
      stake: 1n,
    })
    expect(stakeActivationState(a, 201n)).toBe('inactive')
  })
})
