import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CosmosChain } from '../../../Chain'
import { getCosmosAccountInfo } from './getCosmosAccountInfo'

vi.mock('../client', () => ({
  getCosmosClient: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getCosmosClient } from '../client'

const baseBlock = {
  header: { time: '2026-05-27T00:00:00.000Z', height: '12345' },
}

const makeClient = (account: { accountNumber: number; sequence: number; pubkey?: unknown } | null) => ({
  getAccount: vi.fn().mockResolvedValue(account),
  getBlock: vi.fn().mockResolvedValue(baseBlock),
})

describe('getCosmosAccountInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns sequence directly when StargateClient resolves the account', async () => {
    const client = makeClient({ accountNumber: 12, sequence: 84 })
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result.accountNumber).toBe(12)
    expect(result.sequence).toBe(84)
    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('falls back to LCD when StargateClient returns null (extended account type) and returns chain-known sequence', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.auth.v1beta1.BaseAccount',
        address: 'terra1real',
        pub_key: null,
        account_number: '12',
        sequence: '84',
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result.accountNumber).toBe(12)
    expect(result.sequence).toBe(84)
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toContain('/cosmos/auth/v1beta1/accounts/terra1real')
  })

  it('parses nested base_vesting_account.base_account shape from LCD', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.vesting.v1beta1.PeriodicVestingAccount',
        base_vesting_account: {
          base_account: {
            address: 'terra1vest',
            pub_key: null,
            account_number: '99',
            sequence: '42',
          },
        },
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1vest',
    })

    expect(result.accountNumber).toBe(99)
    expect(result.sequence).toBe(42)
  })

  it('parses nested base_account shape (non-vesting wrapper) from LCD', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.auth.v1beta1.ModuleAccount',
        base_account: {
          address: 'terra1mod',
          pub_key: null,
          account_number: '7',
          sequence: '3',
        },
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1mod',
    })

    expect(result.accountNumber).toBe(7)
    expect(result.sequence).toBe(3)
  })

  it('falls through to sequence:0 when BOTH RPC and LCD return null (genuinely new account)', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(new Error('account not found'))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1new',
    })

    // Correct behavior for a brand-new on-chain account: sequence 0
    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
  })

  it('still falls through to 0 when LCD returns malformed JSON', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({} as never) // no `account` field

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1empty',
    })

    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
  })
})
