import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./config', () => ({ cardanoApiUrl: 'https://api.test/cardano' }))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getCardanoAddressAssets } from './getCardanoAddressAssets'

const asset = (i: number) => ({
  address: 'addr1',
  policy_id: `pol${i}`,
  asset_name: `name${i}`,
  fingerprint: `fp${i}`,
  decimals: 0,
  quantity: '1',
})

describe('getCardanoAddressAssets pagination', () => {
  beforeEach(() => vi.mocked(queryUrl).mockReset())

  it('follows offsets until a short page and returns every asset (>1000)', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => asset(i)) as never)
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => asset(1000 + i)) as never)
      .mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => asset(2000 + i)) as never)

    const res = await getCardanoAddressAssets('addr1')

    expect(res).toHaveLength(2012)
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(3)
    // offsets thread 0 -> 1000 -> 2000
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toContain('offset=0')
    expect(vi.mocked(queryUrl).mock.calls[1]?.[0]).toContain('offset=1000')
    expect(vi.mocked(queryUrl).mock.calls[2]?.[0]).toContain('offset=2000')
  })

  it('stops after one call when the first page is short (common case)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce([asset(0), asset(1)] as never)

    const res = await getCardanoAddressAssets('addr1')

    expect(res).toHaveLength(2)
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(1)
  })

  it('normalizes a null decimals to 0', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce([{ ...asset(0), decimals: null }] as never)

    const res = await getCardanoAddressAssets('addr1')

    expect(res[0]?.decimals).toBe(0)
  })

  it('caps the page walk so an offset-ignoring Koios that never returns a short page cannot loop forever', async () => {
    // A misbehaving Koios (or a caching proxy) that returns a FULL 1000-row page
    // for every offset would loop forever without a cap. MAX_PAGES = 100 bounds it.
    const fullPage = Array.from({ length: 1000 }, (_, i) => asset(i))
    vi.mocked(queryUrl).mockResolvedValue(fullPage as never)

    const res = await getCardanoAddressAssets('addr1')

    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(100)
    expect(res).toHaveLength(100_000)
  })
})
