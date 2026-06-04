import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CosmosChain } from '../../../Chain'
import { getCosmosCoinBalance } from './cosmos'

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const makeClient = (amount: string) => ({
  getBalance: vi.fn().mockResolvedValue({ denom: 'uluna', amount }),
})

describe('getCosmosCoinBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the RPC balance when StargateClient resolves a non-zero amount', async () => {
    const client = makeClient('4800000000')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.TerraClassic,
      address: 'terra1real',
    })

    expect(result).toBe(4_800_000_000n)
    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('falls back to LCD when StargateClient returns 0n and LCD has a real balance', async () => {
    const client = makeClient('0')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      balance: { denom: 'uluna', amount: '4800000000' },
    } as never)

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.TerraClassic,
      address: 'terra14qel5wtnrtdgvkd8v0n3wz3nw5rqtcnf5n24r4',
    })

    expect(result).toBe(4_800_000_000n)
    const calledUrl = vi.mocked(queryUrl).mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('/cosmos/bank/v1beta1/balances/')
    expect(calledUrl).toContain('by_denom?denom=uluna')
  })

  it('returns 0n when BOTH RPC and LCD return zero (genuinely empty wallet)', async () => {
    const client = makeClient('0')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      balance: { denom: 'uluna', amount: '0' },
    } as never)

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.TerraClassic,
      address: 'terra1empty',
    })

    expect(result).toBe(0n)
  })

  it('returns 0n when RPC returns 0 and LCD response is malformed', async () => {
    const client = makeClient('0')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({} as never)

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.TerraClassic,
      address: 'terra1empty',
    })

    expect(result).toBe(0n)
  })

  it('returns 0n when RPC returns 0 and LCD rejects (404 / network)', async () => {
    const client = makeClient('0')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(new Error('account not found'))

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.TerraClassic,
      address: 'terra1new',
    })

    expect(result).toBe(0n)
  })

  it('does NOT call LCD when RPC returns a positive balance (no extra round-trip)', async () => {
    const client = makeClient('1')
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    const result = await getCosmosCoinBalance({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result).toBe(1n)
    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('URL-encodes the denom query parameter (factory/, ibc/ denoms)', async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue({ denom: 'factory/x/y', amount: '0' }),
    }
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      balance: { denom: 'factory/x/y', amount: '0' },
    } as never)

    await getCosmosCoinBalance({
      chain: CosmosChain.Kujira,
      address: 'kujira1abc',
      id: 'factory/x/y',
    })

    const calledUrl = vi.mocked(queryUrl).mock.calls[0]?.[0] as string
    // 'factory/x/y' must be encoded — slashes turn into %2F so the query
    // path is unambiguous against the LCD route segments.
    expect(calledUrl).toContain('by_denom?denom=factory%2Fx%2Fy')
  })
})
