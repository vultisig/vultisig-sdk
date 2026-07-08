import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl', () => ({
  getCosmosRpcUrl: () => 'https://lcd.test',
}))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { Chain } from '../../../Chain'
import { getAllCosmosBalances } from './getAllCosmosBalances'

const bal = (denom: string) => ({ denom, amount: '1' })

describe('getAllCosmosBalances', () => {
  beforeEach(() => vi.mocked(queryUrl).mockReset())

  it('follows pagination.next_key across pages until it is null', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({ balances: [bal('uatom'), bal('ibc/AAA')], pagination: { next_key: 'k1' } } as never)
      .mockResolvedValueOnce({ balances: [bal('ibc/BBB')], pagination: { next_key: 'k2' } } as never)
      .mockResolvedValueOnce({ balances: [bal('ibc/CCC')], pagination: { next_key: null } } as never)

    const res = await getAllCosmosBalances(Chain.Osmosis, 'osmo1abc')

    expect(res.map(b => b.denom)).toEqual(['uatom', 'ibc/AAA', 'ibc/BBB', 'ibc/CCC'])
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toContain('pagination.limit=1000')
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).not.toContain('pagination.key')
    expect(vi.mocked(queryUrl).mock.calls[1]?.[0]).toContain('pagination.key=k1')
    expect(vi.mocked(queryUrl).mock.calls[2]?.[0]).toContain('pagination.key=k2')
  })

  it('stops after one page when next_key is empty', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      balances: [bal('uatom')],
      pagination: { next_key: '' },
    } as never)

    const res = await getAllCosmosBalances(Chain.THORChain, 'thor1abc')

    expect(res).toHaveLength(1)
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(1)
  })

  it('tolerates a missing balances array', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({ pagination: { next_key: null } } as never)

    const res = await getAllCosmosBalances(Chain.Osmosis, 'osmo1empty')

    expect(res).toEqual([])
  })

  it('caps the page walk so a never-null next_key cannot loop forever', async () => {
    vi.mocked(queryUrl).mockResolvedValue({ balances: [bal('x')], pagination: { next_key: 'always' } } as never)

    const res = await getAllCosmosBalances(Chain.Osmosis, 'osmo1loop')

    // MAX_PAGES = 20
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(20)
    expect(res).toHaveLength(20)
  })
})
