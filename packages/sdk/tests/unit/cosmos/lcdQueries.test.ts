/**
 * LCD query helper tests for the cosmos-sdk staking + distribution module.
 *
 * Strategy: mix of mocked-fetch shape tests AND real-fixture round-trip
 * tests using captured LCD responses from a real Cosmos Hub address that
 * actively stakes (`cosmos1a8l3srqyk5krvzhkt7cyzy52yxcght6322w2qy`,
 * 2 delegations + 1 active unbonding + accrued rewards as of capture time).
 *
 * Fixtures live in `./fixtures/` and were captured directly from
 * https://cosmos-rest.publicnode.com — see commit notes for capture date.
 * They're checked in so the test suite runs offline + deterministically.
 */
import {
  getAuthAccountUrl,
  getCosmosDelegations,
  getCosmosDelegatorRewards,
  getCosmosUnbondingDelegations,
  getCosmosVestingAccount,
  getDelegationsUrl,
  getDelegatorRewardsUrl,
  getUnbondingDelegationsUrl,
} from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const fixtureDir = resolve(__dirname, './fixtures')
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf-8'))
}

const cosmoshubDelegations = loadFixture('cosmoshub-delegations.json')
const cosmoshubRewards = loadFixture('cosmoshub-rewards.json')
const cosmoshubUnbonding = loadFixture('cosmoshub-unbonding.json')
const cosmoshubAuth = loadFixture('cosmoshub-auth.json')

const REAL_ADDR = 'cosmos1a8l3srqyk5krvzhkt7cyzy52yxcght6322w2qy'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(json: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  }) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('cosmos staking / URL builders', () => {
  it('builds Cosmos Hub delegations URL', () => {
    expect(getDelegationsUrl('Cosmos', REAL_ADDR)).toBe(
      `https://cosmos-rest.publicnode.com/cosmos/staking/v1beta1/delegations/${REAL_ADDR}`
    )
  })

  it('builds Terra V2 unbonding delegations URL', () => {
    expect(getUnbondingDelegationsUrl('Terra', 'terra1abc')).toBe(
      'https://terra-lcd.publicnode.com/cosmos/staking/v1beta1/delegators/terra1abc/unbonding_delegations'
    )
  })

  it('builds Osmosis rewards URL (distribution module path, not staking)', () => {
    expect(getDelegatorRewardsUrl('Osmosis', 'osmo1abc')).toBe(
      'https://osmosis-rest.publicnode.com/cosmos/distribution/v1beta1/delegators/osmo1abc/rewards'
    )
  })

  it('builds Kujira auth account URL (used for vesting account detection)', () => {
    expect(getAuthAccountUrl('Kujira', 'kujira1abc')).toBe(
      'https://kujira-rest.publicnode.com/cosmos/auth/v1beta1/accounts/kujira1abc'
    )
  })
})

// ---------------------------------------------------------------------------
// Real-fixture round-trip tests
// ---------------------------------------------------------------------------

describe('cosmos staking / real cosmoshub fixtures', () => {
  it('parses 2-validator delegations from cosmos1a8l3srqyk... real response', async () => {
    const fetchImpl = mockFetch(cosmoshubDelegations)
    const result = await getCosmosDelegations('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      validatorAddress: 'cosmosvaloper1hjct6q7npsspsg3dgvzk3sdf89spmlpfdn6m9d',
      balance: { denom: 'uatom', amount: '637980' },
      shares: '637980.000000000000000000',
    })
    expect(result[1]).toEqual({
      validatorAddress: 'cosmosvaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn',
      balance: { denom: 'uatom', amount: '219123' },
      shares: '219123.000000000000000000',
    })
  })

  it('parses real rewards response (multi-validator + total)', async () => {
    const fetchImpl = mockFetch(cosmoshubRewards)
    const result = await getCosmosDelegatorRewards('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result.rewards).toHaveLength(2)
    expect(result.rewards[0].validatorAddress).toBe('cosmosvaloper1hjct6q7npsspsg3dgvzk3sdf89spmlpfdn6m9d')
    expect(result.rewards[0].reward).toEqual([{ denom: 'uatom', amount: '27022.237161045624390900' }])
    expect(result.total).toEqual([{ denom: 'uatom', amount: '36711.360762746979967149' }])
  })

  it('parses real unbonding response with completion_time', async () => {
    const fetchImpl = mockFetch(cosmoshubUnbonding)
    const result = await getCosmosUnbondingDelegations('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result).toHaveLength(1)
    expect(result[0].validatorAddress).toBe('cosmosvaloper199mlc7fr6ll5t54w7tts7f4s0cvnqgc59nmuxf')
    expect(result[0].entries).toHaveLength(1)
    expect(result[0].entries[0]).toEqual({
      creationHeight: '30672025',
      completionTime: '2026-05-06T08:48:29.895374118Z',
      initialBalance: '645531',
      balance: '645531',
    })
  })

  it('returns null on real BaseAccount auth response (non-vesting cosmoshub address)', async () => {
    const fetchImpl = mockFetch(cosmoshubAuth)
    const result = await getCosmosVestingAccount('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('cosmos staking / getCosmosDelegations edge cases', () => {
  it('handles empty delegations gracefully', async () => {
    const fetchImpl = mockFetch({ delegation_responses: [] })
    const result = await getCosmosDelegations('Cosmos', 'cosmos1nodelegations', { fetchImpl })
    expect(result).toEqual([])
  })

  it('throws on non-2xx response', async () => {
    const fetchImpl = mockFetch({ message: 'rate-limited' }, 429)
    await expect(getCosmosDelegations('Cosmos', REAL_ADDR, { fetchImpl })).rejects.toThrow(/LCD 429/)
  })
})

describe('cosmos staking / getCosmosUnbondingDelegations edge cases', () => {
  it('handles multiple entries per validator (laddered unbondings)', async () => {
    const fetchImpl = mockFetch({
      unbonding_responses: [
        {
          delegator_address: REAL_ADDR,
          validator_address: 'cosmosvaloper1aaa',
          entries: [
            { creation_height: '100', completion_time: 't1', initial_balance: '1', balance: '1' },
            { creation_height: '200', completion_time: 't2', initial_balance: '2', balance: '2' },
            { creation_height: '300', completion_time: 't3', initial_balance: '3', balance: '3' },
          ],
        },
      ],
    })
    const result = await getCosmosUnbondingDelegations('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result[0].entries).toHaveLength(3)
  })
})

describe('cosmos staking / getCosmosDelegatorRewards edge cases', () => {
  it('handles missing total field (older chain firmware) without throwing', async () => {
    const fetchImpl = mockFetch({ rewards: [] })
    const result = await getCosmosDelegatorRewards('Cosmos', REAL_ADDR, { fetchImpl })
    expect(result.total).toEqual([])
  })
})

describe('cosmos staking / getCosmosVestingAccount edge cases', () => {
  it('returns the account when @type is PeriodicVestingAccount', async () => {
    const fetchImpl = mockFetch({
      account: {
        '@type': '/cosmos.vesting.v1beta1.PeriodicVestingAccount',
        base_vesting_account: {
          base_account: { address: 'terra1xxx', account_number: '42', sequence: '7' },
          original_vesting: [{ denom: 'uluna', amount: '10000000' }],
          delegated_free: [],
          delegated_vesting: [{ denom: 'uluna', amount: '8000000' }],
          end_time: '1716595200',
        },
        start_time: '1653523200',
        vesting_periods: [{ length: '63072000', amount: [{ denom: 'uluna', amount: '10000000' }] }],
      },
    })
    const result = await getCosmosVestingAccount('Terra', 'terra1xxx', { fetchImpl })
    expect(result).not.toBeNull()
    expect(result?.['@type']).toBe('/cosmos.vesting.v1beta1.PeriodicVestingAccount')
  })

  it('returns null on 404 (brand-new address never seen on-chain)', async () => {
    const fetchImpl = mockFetch({ message: 'account not found' }, 404)
    const result = await getCosmosVestingAccount('Cosmos', 'cosmos1unknown', { fetchImpl })
    expect(result).toBeNull()
  })

  it('rethrows non-404 errors so caller can distinguish "not vesting" from "broken"', async () => {
    const fetchImpl = mockFetch({ message: 'gateway' }, 502)
    await expect(getCosmosVestingAccount('Cosmos', REAL_ADDR, { fetchImpl })).rejects.toThrow(/LCD 502/)
  })

  it('recognizes Continuous + Delayed vesting account types', async () => {
    const continuous = mockFetch({
      account: {
        '@type': '/cosmos.vesting.v1beta1.ContinuousVestingAccount',
        base_vesting_account: {
          base_account: { address: 'x', account_number: '1', sequence: '0' },
          original_vesting: [],
          delegated_free: [],
          delegated_vesting: [],
          end_time: '0',
        },
        start_time: '0',
      },
    })
    expect(await getCosmosVestingAccount('Cosmos', 'x', { fetchImpl: continuous })).not.toBeNull()

    const delayed = mockFetch({
      account: {
        '@type': '/cosmos.vesting.v1beta1.DelayedVestingAccount',
        base_vesting_account: {
          base_account: { address: 'x', account_number: '1', sequence: '0' },
          original_vesting: [],
          delegated_free: [],
          delegated_vesting: [],
          end_time: '0',
        },
      },
    })
    expect(await getCosmosVestingAccount('Cosmos', 'x', { fetchImpl: delayed })).not.toBeNull()
  })
})
