import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RujiraClient } from '../client.js'
import { RujiraError } from '../errors.js'
import { RujiraRange } from '../modules/range.js'
import { VALID_THOR_ADDRESS_2 } from './test-helpers.js'

// Known-valid thor1 (RUJI staking contract) — we only need a real bech32 checksum.
const validThor = 'thor13g83nn5ef4qzqeafp0508dnvkvm0zqr3sj7eefcn5umu65gqluusrml5cr'
// Reusing the same bech32-valid contract-shaped thor1 for pair addresses.
const validPair = validThor
const forgedPair = VALID_THOR_ADDRESS_2

const baseCoin = { denom: 'btc-btc', amount: '100000000' }
const quoteCoin = { denom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1000000000' }

const validConfig = {
  high: '80000.000000000000',
  low: '40000.000000000000',
  spread: '0.030000000000',
  skew: '0.000000000000',
  fee: '0.030000000000',
}

const pairEdge = (
  address: string,
  baseSymbol = 'RUJI',
  quoteSymbol = 'RUNE',
  baseDenom = `x/${baseSymbol.toLowerCase()}`,
  quoteDenom = `thor.${quoteSymbol.toLowerCase()}`
) => ({
  node: {
    address,
    assetBase: { metadata: { symbol: baseSymbol }, variants: { native: { denom: baseDenom } } },
    assetQuote: {
      metadata: { symbol: quoteSymbol },
      variants: { native: { denom: quoteDenom } },
    },
  },
})

const mockPairFetch = (...edgeSets: Array<ReturnType<typeof pairEdge>[]>) => {
  const fetchMock = vi.fn()
  for (const edges of edgeSets) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          finV3: {
            pairs: { edges, pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RujiraRange builders', () => {
  let range: RujiraRange

  beforeEach(async () => {
    range = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)
    mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)])
    await range.getPairAddress(baseCoin.denom, quoteCoin.denom)
  })

  describe('buildCreatePosition', () => {
    it('emits range.create with config + sorted funds', () => {
      const tx = range.buildCreatePosition({
        pairAddress: validPair,
        config: validConfig,
        base: baseCoin,
        quote: quoteCoin,
      })
      expect(tx.contractAddress).toBe(validPair)
      expect(tx.executeMsg).toEqual({
        range: {
          create: {
            config: {
              high: '80000.000000000000',
              low: '40000.000000000000',
              spread: '0.030000000000',
              skew: '0.000000000000',
              fee: '0.030000000000',
            },
          },
        },
      })
      // Funds sorted lexically by denom (cosmos ordering convention).
      expect(tx.funds.map(c => c.denom)).toEqual([baseCoin.denom, quoteCoin.denom].sort())
    })

    it('rejects numeric config fields (LLM footgun guard)', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, high: 80000 as unknown as string },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(RujiraError)
    })

    it('rejects over-precision (>12dp)', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, spread: '0.0300000000001' },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/12 fractional digits/)
    })

    it('rejects high <= low', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, high: '40000', low: '40000' },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/> config.low/)
    })

    it('rejects spread outside (0, 1)', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, spread: '1' },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/spread must be in/)
    })

    it('rejects fee > spread', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, spread: '0.01', fee: '0.05' },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/fee must be in/)
    })

    it('accepts negative skew', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: validPair,
          config: { ...validConfig, skew: '-0.5' },
          base: baseCoin,
          quote: quoteCoin,
        })
      ).not.toThrow()
    })

    it('rejects invalid pair address', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: 'not-a-thor-addr',
          config: validConfig,
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/pairAddress/)
    })

    it('rejects a bech32-valid contract that is not the authoritative FIN pair', () => {
      expect(() =>
        range.buildCreatePosition({
          pairAddress: forgedPair,
          config: validConfig,
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/does not match the authoritative FIN pair/)
    })

    it('does not trust a caller-injected FIN config entry', () => {
      const unregisteredRange = new RujiraRange({
        config: { contracts: { finContracts: { [`${baseCoin.denom}/${quoteCoin.denom}`]: validPair } } },
      } as RujiraClient)

      expect(() =>
        unregisteredRange.buildCreatePosition({
          pairAddress: validPair,
          config: validConfig,
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/registry is missing or expired/)
    })
  })

  describe('buildDeposit', () => {
    it('emits range.deposit with idx', () => {
      const tx = range.buildDeposit({
        pairAddress: validPair,
        idx: '42',
        base: baseCoin,
        quote: quoteCoin,
      })
      expect(tx.executeMsg).toEqual({ range: { deposit: { idx: '42' } } })
      expect(tx.funds).toHaveLength(2)
    })

    it('rejects numeric idx (precision hazard)', () => {
      expect(() =>
        range.buildDeposit({
          pairAddress: validPair,
          idx: 42 as unknown as string,
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/idx/)
    })

    it('rejects a bech32-valid contract that is not the authoritative FIN pair', () => {
      expect(() =>
        range.buildDeposit({
          pairAddress: forgedPair,
          idx: '42',
          base: baseCoin,
          quote: quoteCoin,
        })
      ).toThrow(/does not match the authoritative FIN pair/)
    })
  })

  describe('buildWithdraw', () => {
    it('emits range.withdraw with share amount', () => {
      const tx = range.buildWithdraw({ pairAddress: validPair, idx: '7', share: '0.5' })
      expect(tx.executeMsg).toEqual({ range: { withdraw: { idx: '7', amount: '0.5' } } })
      expect(tx.funds).toEqual([])
    })

    it('accepts share = 1 (full withdraw without claim)', () => {
      const tx = range.buildWithdraw({ pairAddress: validPair, idx: '7', share: '1' })
      expect((tx.executeMsg as { range: { withdraw: { amount: string } } }).range.withdraw.amount).toBe('1')
    })

    it('rejects share > 1', () => {
      expect(() => range.buildWithdraw({ pairAddress: validPair, idx: '7', share: '1.5' })).toThrow(/0, 1/)
    })

    it('rejects share = 0', () => {
      expect(() => range.buildWithdraw({ pairAddress: validPair, idx: '7', share: '0' })).toThrow(/0, 1/)
    })

    it('rejects share with >4dp', () => {
      expect(() => range.buildWithdraw({ pairAddress: validPair, idx: '7', share: '0.12345' })).toThrow(/4 fractional/)
    })
  })

  describe('buildClaim', () => {
    it('emits range.claim with idx, no funds', () => {
      const tx = range.buildClaim({ pairAddress: validPair, idx: '1' })
      expect(tx.executeMsg).toEqual({ range: { claim: { idx: '1' } } })
      expect(tx.funds).toEqual([])
    })
  })

  describe('buildTransfer', () => {
    it('emits range.transfer with idx + to', () => {
      const tx = range.buildTransfer({ pairAddress: validPair, idx: '3', to: validThor })
      expect(tx.executeMsg).toEqual({ range: { transfer: { idx: '3', to: validThor } } })
    })

    it('rejects non-thor1 destination', () => {
      expect(() =>
        range.buildTransfer({ pairAddress: validPair, idx: '3', to: 'maya1abcdefghijklmnopqrstuvwxyz012345' })
      ).toThrow()
    })
  })

  describe('buildWithdrawAll', () => {
    it('emits [claim, withdraw(1)] in order for atomic close', () => {
      const tx = range.buildWithdrawAll({ pairAddress: validPair, idx: '9' })
      expect(tx.msgs).toHaveLength(2)
      expect(tx.msgs[0].executeMsg).toEqual({ range: { claim: { idx: '9' } } })
      expect(tx.msgs[1].executeMsg).toEqual({ range: { withdraw: { idx: '9', amount: '1' } } })
      expect(tx.msgs.every(m => m.contractAddress === validPair)).toBe(true)
      expect(tx.msgs.every(m => m.funds.length === 0)).toBe(true)
    })
  })
})

describe('RujiraRange queries', () => {
  it('hydrates the authoritative FIN registry for subsequent range builders', async () => {
    const localClient = {
      config: { contracts: { finContracts: {} } },
    } as RujiraClient
    const localRange = new RujiraRange(localClient)
    mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)])

    await expect(localRange.getPairAddress(baseCoin.denom, quoteCoin.denom)).resolves.toMatchObject({
      address: validPair,
    })
    expect(() =>
      localRange.buildDeposit({ pairAddress: validPair, idx: '42', base: baseCoin, quote: quoteCoin })
    ).not.toThrow()
  })

  it('caches the FIN pair list across pair-address lookups', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const fetchMock = mockPairFetch([pairEdge(validPair)])
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    const first = await localRange.getPairAddress('RUJI', 'RUNE')
    const second = await localRange.getPairAddress('x/ruji', 'thor.rune')

    expect(first?.address).toBe(validPair)
    expect(second?.address).toBe(validPair)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight FIN pair list fetch across concurrent pair-address lookups', async () => {
    vi.useFakeTimers({ now: 1_000 })
    let resolveFetch!: (response: Response) => void
    const fetchPromise = new Promise<Response>(resolve => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => fetchPromise)
    vi.stubGlobal('fetch', fetchMock)
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    const first = localRange.getPairAddress('RUJI', 'RUNE')
    const second = localRange.getPairAddress('x/ruji', 'thor.rune')

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({
      ok: true,
      json: async () => ({
        data: {
          finV3: {
            pairs: { edges: [pairEdge(validPair)], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    } as Response)

    const results = await Promise.all([first, second])
    expect(results.map(result => result?.address)).toEqual([validPair, validPair])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes the FIN pair list after the cache TTL expires', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const refreshedPair = VALID_THOR_ADDRESS_2
    const fetchMock = mockPairFetch([pairEdge(validPair)], [pairEdge(refreshedPair)])
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    const first = await localRange.getPairAddress('RUJI', 'RUNE')
    vi.setSystemTime(1_000 + 5 * 60 * 1000 + 1)
    const second = await localRange.getPairAddress('RUJI', 'RUNE')

    expect(first?.address).toBe(validPair)
    expect(second?.address).toBe(refreshedPair)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a resolved authoritative snapshot expires before refresh', async () => {
    vi.useFakeTimers({ now: 1_000 })
    mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)])
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    await localRange.getPairAddress(baseCoin.denom, quoteCoin.denom)
    expect(() =>
      localRange.buildDeposit({ pairAddress: validPair, idx: '42', base: baseCoin, quote: quoteCoin })
    ).not.toThrow()

    vi.setSystemTime(1_000 + 5 * 60 * 1000)
    expect(() =>
      localRange.buildDeposit({ pairAddress: validPair, idx: '42', base: baseCoin, quote: quoteCoin })
    ).toThrow(/registry is missing or expired/)
  })

  it('revokes a previously resolved pair when a successful refresh removes it', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const fetchMock = mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)], [])
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    await expect(localRange.getPairAddress(baseCoin.denom, quoteCoin.denom)).resolves.toMatchObject({
      address: validPair,
    })
    expect(() =>
      localRange.buildDeposit({ pairAddress: validPair, idx: '42', base: baseCoin, quote: quoteCoin })
    ).not.toThrow()

    vi.setSystemTime(1_000 + 5 * 60 * 1000 + 1)
    await expect(localRange.getPairAddress(baseCoin.denom, quoteCoin.denom)).resolves.toBeNull()
    expect(() =>
      localRange.buildDeposit({ pairAddress: validPair, idx: '42', base: baseCoin, quote: quoteCoin })
    ).toThrow(/No authoritative FIN pair is registered/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a malformed FIN pair-list response', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { finV3: { pairs: {} } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            finV3: { pairs: { edges: [pairEdge(validPair)], pageInfo: { hasNextPage: false, endCursor: null } } },
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    await expect(localRange.getPairAddress('RUJI', 'RUNE')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
    await expect(localRange.getPairAddress('RUJI', 'RUNE')).resolves.toMatchObject({ address: validPair })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache malformed FIN pair edges', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { finV3: { pairs: { edges: [{ node: { address: validPair, assetBase: {} } }] } } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            finV3: { pairs: { edges: [pairEdge(validPair)], pageInfo: { hasNextPage: false, endCursor: null } } },
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const localRange = new RujiraRange({ config: { contracts: { finContracts: {} } } } as RujiraClient)

    await expect(localRange.getPairAddress('RUJI', 'RUNE')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
    await expect(localRange.getPairAddress('RUJI', 'RUNE')).resolves.toMatchObject({ address: validPair })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe.each(['create', 'deposit'] as const)('RujiraRange %s authority boundaries', builder => {
  const build = (range: RujiraRange, address = validPair, base = baseCoin, quote = quoteCoin) =>
    builder === 'create'
      ? range.buildCreatePosition({ pairAddress: address, base, quote, config: validConfig })
      : range.buildDeposit({ pairAddress: address, base, quote, idx: '42' })

  it('rejects missing authority even with injected client configuration', () => {
    const range = new RujiraRange({
      config: {
        contracts: {
          finContracts: {
            [`${baseCoin.denom}/${quoteCoin.denom}`]: validPair,
          },
        },
      },
    } as RujiraClient)
    expect(() => build(range)).toThrow(/registry is missing or expired/)
  })

  it('requires exact ordered denoms rather than discovery aliases', async () => {
    const range = new RujiraRange({} as RujiraClient)
    mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)])
    await range.getPairAddress('BTC', 'USDC')
    expect(() => build(range, validPair, { ...baseCoin, denom: baseCoin.denom.toUpperCase() })).toThrow(
      /No authoritative FIN pair/
    )
    expect(() => build(range, validPair, quoteCoin, baseCoin)).toThrow(/No authoritative FIN pair/)
    expect(() => build(range, validPair, { ...baseCoin, denom: 'unknown' })).toThrow(/No authoritative FIN pair/)
  })

  it('does not confuse denomination tuples containing slashes', async () => {
    const range = new RujiraRange({} as RujiraClient)
    mockPairFetch([pairEdge(validPair, 'A', 'B', 'aaa/bbb', 'ccc'), pairEdge(forgedPair, 'C', 'D', 'aaa', 'bbb/ccc')])
    await range.getPairAddress('A', 'B')
    const base = { ...baseCoin, denom: 'aaa/bbb' }
    const quote = { ...quoteCoin, denom: 'ccc' }
    expect(build(range, validPair, base, quote).contractAddress).toBe(validPair)
    expect(() => build(range, forgedPair, base, quote)).toThrow(/does not match/)
    expect(build(range, forgedPair, { ...base, denom: 'aaa' }, { ...quote, denom: 'bbb/ccc' }).contractAddress).toBe(
      forgedPair
    )
  })

  it('expires authority and revokes a replaced contract after refresh', async () => {
    vi.useFakeTimers({ now: 1000 })
    const range = new RujiraRange({} as RujiraClient)
    mockPairFetch(
      [pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)],
      [pairEdge(forgedPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)],
      []
    )
    await range.getPairAddress('BTC', 'USDC')
    expect(build(range).contractAddress).toBe(validPair)
    vi.setSystemTime(301000)
    expect(() => build(range)).toThrow(/registry is missing or expired/)
    await range.getPairAddress('BTC', 'USDC')
    expect(() => build(range)).toThrow(/does not match/)
    expect(build(range, forgedPair).contractAddress).toBe(forgedPair)
    vi.setSystemTime(601000)
    await range.getPairAddress('BTC', 'USDC')
    expect(() => build(range, forgedPair)).toThrow(/No authoritative FIN pair/)
  })

  it.each([undefined, '', 123, {}, 'bad denom'])('rejects malformed registry denom %j atomically', async denom => {
    const range = new RujiraRange({} as RujiraClient)
    const malformed = pairEdge(forgedPair)
    malformed.node.assetBase.variants.native.denom = denom as string
    mockPairFetch([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom), malformed])
    await expect(range.getPairAddress('BTC', 'USDC')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(() => build(range)).toThrow(/registry is missing or expired/)
  })

  it('rejects conflicting contracts atomically', async () => {
    const range = new RujiraRange({} as RujiraClient)
    mockPairFetch(
      [validPair, forgedPair].map(address => pairEdge(address, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom))
    )
    await expect(range.getPairAddress('BTC', 'USDC')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(() => build(range)).toThrow(/registry is missing or expired/)
  })
})

describe('complete FIN authority pagination', () => {
  const response = (edges: ReturnType<typeof pairEdge>[], hasNextPage = false, endCursor: string | null = null) => ({
    ok: true,
    json: async () => ({ data: { finV3: { pairs: { edges, pageInfo: { hasNextPage, endCursor } } } } }),
  })
  const buildBoth = (range: RujiraRange) => [
    () => range.buildCreatePosition({ pairAddress: validPair, base: baseCoin, quote: quoteCoin, config: validConfig }),
    () => range.buildDeposit({ pairAddress: validPair, base: baseCoin, quote: quoteCoin, idx: '42' }),
  ]

  it('authorizes a market beyond the first 200 rows only after exhausting the connection', async () => {
    const firstPage = Array.from({ length: 200 }, () => pairEdge(forgedPair))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(firstPage, true, 'page-1'))
      .mockResolvedValueOnce(response([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)]))
    vi.stubGlobal('fetch', fetchMock)
    const range = new RujiraRange({} as RujiraClient)
    const pair = await range.getPairAddress(baseCoin.denom, quoteCoin.denom)
    expect(pair?.address).toBe(validPair)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({ after: 'page-1' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain('sortBy: NAME')
    for (const build of buildBoth(range)) expect(build().contractAddress).toBe(validPair)
  })

  it.each(['network', 'missing pageInfo', 'repeated cursor', 'empty advancing page'])(
    'never publishes partial authority after %s',
    async failure => {
      const first = response([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)], true, 'same-cursor')
      const second =
        failure === 'network'
          ? { ok: false, status: 503 }
          : failure === 'missing pageInfo'
            ? { ok: true, json: async () => ({ data: { finV3: { pairs: { edges: [] } } } }) }
            : response(
                failure === 'empty advancing page' ? [] : [pairEdge(forgedPair)],
                true,
                failure === 'repeated cursor' ? 'same-cursor' : 'new-cursor'
              )
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second))
      const range = new RujiraRange({} as RujiraClient)
      await expect(range.getPairAddress(baseCoin.denom, quoteCoin.denom)).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      })
      for (const build of buildBoth(range)) expect(build).toThrow(/missing or expired/)
    }
  )

  it('rejects conflicting contracts split across pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response([pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)], true, 'next')
        )
        .mockResolvedValueOnce(response([pairEdge(forgedPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)]))
    )
    const range = new RujiraRange({} as RujiraClient)
    await expect(range.getPairAddress(baseCoin.denom, quoteCoin.denom)).rejects.toThrow(/conflicting contracts/)
    for (const build of buildBoth(range)) expect(build).toThrow(/missing or expired/)
  })

  it('rejects one contract assigned to different markets', async () => {
    mockPairFetch([pairEdge(validPair), pairEdge(validPair, 'BTC', 'USDC', baseCoin.denom, quoteCoin.denom)])
    const range = new RujiraRange({} as RujiraClient)
    await expect(range.getPairAddress('RUJI', 'RUNE')).rejects.toThrow(/conflicting markets/)
  })
})
