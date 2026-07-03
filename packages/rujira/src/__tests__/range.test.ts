import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RujiraClient } from '../client.js'
import { RujiraError } from '../errors.js'
import { RujiraRange } from '../modules/range.js'

const client = {} as RujiraClient
const range = new RujiraRange(client)

// Known-valid thor1 (RUJI staking contract) — we only need a real bech32 checksum.
const validThor = 'thor13g83nn5ef4qzqeafp0508dnvkvm0zqr3sj7eefcn5umu65gqluusrml5cr'
// Reusing the same bech32-valid contract-shaped thor1 for pair addresses.
const validPair = validThor

const baseCoin = { denom: 'btc-btc', amount: '100000000' }
const quoteCoin = { denom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1000000000' }

const validConfig = {
  high: '80000.000000000000',
  low: '40000.000000000000',
  spread: '0.030000000000',
  skew: '0.000000000000',
  fee: '0.030000000000',
}

const pairEdge = (address: string, baseSymbol = 'RUJI', quoteSymbol = 'RUNE') => ({
  node: {
    address,
    assetBase: { metadata: { symbol: baseSymbol }, variants: { native: { denom: `x/${baseSymbol.toLowerCase()}` } } },
    assetQuote: {
      metadata: { symbol: quoteSymbol },
      variants: { native: { denom: `thor.${quoteSymbol.toLowerCase()}` } },
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
            pairs: { edges },
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
  it('caches the FIN pair list across pair-address lookups', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const fetchMock = mockPairFetch([pairEdge(validPair)])
    const localRange = new RujiraRange(client)

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
    const localRange = new RujiraRange(client)

    const first = localRange.getPairAddress('RUJI', 'RUNE')
    const second = localRange.getPairAddress('x/ruji', 'thor.rune')

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({
      ok: true,
      json: async () => ({
        data: {
          finV3: {
            pairs: { edges: [pairEdge(validPair)] },
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
    const refreshedPair = 'thor1ezh0vln0axp6r45vhwjdyrhsq3xezh7pfyqqla'
    const fetchMock = mockPairFetch([pairEdge(validPair)], [pairEdge(refreshedPair)])
    const localRange = new RujiraRange(client)

    const first = await localRange.getPairAddress('RUJI', 'RUNE')
    vi.setSystemTime(1_000 + 5 * 60 * 1000 + 1)
    const second = await localRange.getPairAddress('RUJI', 'RUNE')

    expect(first?.address).toBe(validPair)
    expect(second?.address).toBe(refreshedPair)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
