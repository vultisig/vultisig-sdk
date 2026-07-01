import { describe, expect, it } from 'vitest'

import { solanaStakingConfig } from './config'
import { evaluateCooldown } from './cooldownGate'
import { SolanaStakeAccount } from './models/stakeAccount'

const account = (delegation: SolanaStakeAccount['delegation']): SolanaStakeAccount => ({
  pubkey: 'S',
  lamports: 1n,
  rentExemptReserve: 0n,
  staker: 's',
  withdrawer: 'w',
  delegation,
})

describe('evaluateCooldown', () => {
  it('is available with no delegation', () => {
    expect(evaluateCooldown(account(undefined), 100n)).toEqual({
      status: 'available',
    })
  })

  it('is available for an active (non-deactivating) delegation', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: solanaStakingConfig.epochSentinel,
      stake: 1n,
    })
    expect(evaluateCooldown(a, 150n)).toEqual({ status: 'available' })
  })

  it('is blocked until the epoch passes the deactivation epoch, unlocking at +1', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: 200n,
      stake: 1n,
    })
    expect(evaluateCooldown(a, 200n)).toEqual({
      status: 'blocked',
      unlocksAtEpoch: 201n,
    })
  })

  it('is available once the network advances past the deactivation epoch', () => {
    const a = account({
      votePubkey: 'v',
      activationEpoch: 100n,
      deactivationEpoch: 200n,
      stake: 1n,
    })
    expect(evaluateCooldown(a, 201n)).toEqual({ status: 'available' })
  })
})
