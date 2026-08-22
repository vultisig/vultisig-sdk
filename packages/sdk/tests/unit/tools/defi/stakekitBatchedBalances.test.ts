import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StakekitBalanceItem, StakekitBalanceQuery } from '@/tools/defi/stakekit'
import {
  chunkStakekitBalanceQueries,
  fetchAllStakekitBalances,
  fetchStakekitBalancesBatch,
} from '@/tools/defi/stakekit'

// architecture#1765 — ported from vultiagent-app's local positions client
// (src/features/dashboard/lib/yieldXyzPositions.ts), the app's only prior
// implementation of multi-network StakeKit balance batching.

function mkItem(overrides: Partial<StakekitBalanceItem> = {}): StakekitBalanceItem {
  return {
    yieldId: 'ethereum-eth-lido-staking',
    balances: [
      {
        address: '0xaaa',
        amount: '1.5',
        amountRaw: '1500000000000000000',
        amountUsd: '3000',
        type: 'active',
        isEarning: true,
        token: { symbol: 'ETH', name: 'Ethereum', decimals: 18, network: 'ethereum', logoURI: '' },
        pendingActions: [],
      },
    ],
    rewardRate: { total: 0.024, rateType: 'APY' },
    ...overrides,
  }
}

describe('chunkStakekitBalanceQueries', () => {
  it('returns [] for empty input', () => {
    expect(chunkStakekitBalanceQueries([])).toEqual([])
  })

  it('returns a single chunk when input <= cap', () => {
    const queries: StakekitBalanceQuery[] = Array.from({ length: 5 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    expect(chunkStakekitBalanceQueries(queries)).toEqual([queries])
  })

  it('chunks at the 25 cap', () => {
    const queries: StakekitBalanceQuery[] = Array.from({ length: 30 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    const chunks = chunkStakekitBalanceQueries(queries)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(25)
    expect(chunks[1]).toHaveLength(5)
  })

  it('respects a custom chunk size', () => {
    expect(chunkStakekitBalanceQueries([{ network: 'ethereum', address: '0x' }], 1)).toHaveLength(1)
  })

  it('rejects a non-positive / non-integer chunk size (would otherwise hang the loop)', () => {
    const queries: StakekitBalanceQuery[] = [{ network: 'ethereum', address: '0xa' }]
    expect(() => chunkStakekitBalanceQueries(queries, 0)).toThrow(/positive integer/)
    expect(() => chunkStakekitBalanceQueries(queries, -5)).toThrow(/positive integer/)
    expect(() => chunkStakekitBalanceQueries(queries, 1.5)).toThrow(/positive integer/)
    expect(() => chunkStakekitBalanceQueries(queries, Number.NaN)).toThrow(/positive integer/)
  })
})

describe('fetchStakekitBalancesBatch', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns empty when queries are empty without hitting the network', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await fetchStakekitBalancesBatch([])
    expect(result).toEqual({ items: [], errors: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends X-API-KEY header, the api.yield.xyz URL, and the { queries } body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [mkItem()], errors: [] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await fetchStakekitBalancesBatch([{ network: 'ethereum', address: '0xaaa' }], 'kk')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    // The server-validated shape requires `queries`, NOT `addresses`/`address`
    // at the top level (that's the different shape STAKEKIT_API_BASE's
    // /yields/balances expects) — pin the shape so a future refactor that
    // renames the key or targets the wrong host fails this test.
    expect(url).toBe('https://api.yield.xyz/v1/yields/balances')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-KEY']).toBe('kk')
    expect(JSON.parse(init.body as string)).toEqual({
      queries: [{ network: 'ethereum', address: '0xaaa' }],
    })
  })

  it('omits X-API-KEY when apiKey not supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], errors: [] }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await fetchStakekitBalancesBatch([{ network: 'ethereum', address: '0xa' }])
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
    expect(init.headers['X-API-KEY']).toBeUndefined()
  })

  it('throws on non-200 response and includes body for diagnostics', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(fetchStakekitBalancesBatch([{ network: 'ethereum', address: '0xa' }], 'kk')).rejects.toThrow(
      /yield\.xyz 429: rate limited/
    )
  })

  it('throws when batch exceeds the 25 cap (defense-in-depth)', async () => {
    const queries: StakekitBalanceQuery[] = Array.from({ length: 26 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    await expect(fetchStakekitBalancesBatch(queries, 'kk')).rejects.toThrow(/exceeds cap 25/)
  })

  it('normalises a null items/errors response to empty arrays', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: null, errors: null }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await fetchStakekitBalancesBatch([{ network: 'ethereum', address: '0xa' }], 'kk')
    expect(result).toEqual({ items: [], errors: [] })
  })
})

describe('fetchAllStakekitBalances', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns empty when queries is empty (no network)', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await fetchAllStakekitBalances([])
    expect(result).toEqual({ items: [], errors: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chunks > 25 queries and concatenates items + errors (multi-network aggregation)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [mkItem({ yieldId: 'a' })], errors: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mkItem({ yieldId: 'b' })], errors: [{ message: 'some-edge-warning' }] }),
      })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const queries: StakekitBalanceQuery[] = Array.from({ length: 30 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    const result = await fetchAllStakekitBalances(queries, 'kk')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.items.map(i => i.yieldId)).toEqual(['a', 'b'])
    expect(result.errors).toEqual([{ message: 'some-edge-warning' }])
  })

  it('does NOT abort the other batches when one rejects, and carries chunk context in errors[]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [mkItem({ yieldId: 'survivor' })], errors: [] }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const queries: StakekitBalanceQuery[] = Array.from({ length: 30 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    const result = await fetchAllStakekitBalances(queries, 'kk')

    expect(result.items.map(i => i.yieldId)).toEqual(['survivor'])
    expect(result.errors[0]?.message).toMatch(/500.+boom/)
    expect(result.errors[0]?.query?.network).toMatch(/^ethereum \(batch of 25\)$/)
    expect(result.errors[0]?.query?.address).toBeUndefined()
  })

  it('THROWS when every batch fails (so a caller can retry/surface an error rather than caching an empty positive result)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom-1' })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom-2' })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const queries: StakekitBalanceQuery[] = Array.from({ length: 30 }, (_, i) => ({
      network: 'ethereum',
      address: `0x${i}`,
    }))
    await expect(fetchAllStakekitBalances(queries, 'kk')).rejects.toThrow(/boom-1|all 2 batch\(es\) failed/)
  })

  it('aggregates queries across MULTIPLE networks in a single logical call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [mkItem({ yieldId: 'ethereum-eth-lido-staking' }), mkItem({ yieldId: 'cosmos-atom-native-staking' })],
        errors: [],
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const queries: StakekitBalanceQuery[] = [
      { network: 'ethereum', address: '0xeth' },
      { network: 'cosmos', address: 'cosmos1abc' },
      { network: 'sui', address: '0xsui' },
    ]
    const result = await fetchAllStakekitBalances(queries, 'kk')

    expect(fetchMock).toHaveBeenCalledTimes(1) // all 3 fit in one ≤25 chunk
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.queries).toEqual(queries)
    expect(result.items).toHaveLength(2)
  })
})
