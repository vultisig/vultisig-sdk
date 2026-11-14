import { Chain } from '@vultisig/core-chain/Chain'
import { nativeSwapApiBaseUrl } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mayanameResolver } from './resolvers/mayaname'
import { thornameResolver } from './resolvers/thorname'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetch = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  globalThis.fetch = fetchMock as typeof fetch

  return fetchMock
}

const record = {
  name: 'vi',
  expire_block_height: 30_000_000,
  owner: 'thor1owner',
  preferred_asset: '.',
  affiliate_collector_rune: '0',
  aliases: [
    { chain: 'THOR', address: 'thor1alias' },
    { chain: 'BTC', address: 'bc1qalias' },
    { chain: 'ETH', address: '0xalias' },
    { chain: 'GAIA', address: 'cosmos1alias' },
  ],
}

describe('thornameResolver', () => {
  it('looks the bare, URL-encoded name up on THORNode', async () => {
    const fetchMock = mockFetch(record)

    await thornameResolver.resolve({ name: 'a+b.thor', chain: Chain.Bitcoin })

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${nativeSwapApiBaseUrl[Chain.THORChain]}/thorname/a%2Bb`)
  })

  it.each([
    [Chain.Bitcoin, 'bc1qalias'],
    [Chain.Ethereum, '0xalias'],
    [Chain.Cosmos, 'cosmos1alias'],
    [Chain.THORChain, 'thor1alias'],
  ])('picks the %s alias', async (chain, address) => {
    mockFetch(record)

    await expect(thornameResolver.resolve({ name: 'vi.thor', chain })).resolves.toEqual({
      kind: 'resolved',
      address,
    })
  })

  it('matches alias chains case-insensitively', async () => {
    mockFetch({ ...record, aliases: [{ chain: 'btc', address: 'bc1qlower' }] })

    await expect(thornameResolver.resolve({ name: 'vi.thor', chain: Chain.Bitcoin })).resolves.toEqual({
      kind: 'resolved',
      address: 'bc1qlower',
    })
  })

  it('reports a name with no alias for the chain apart from a missing one', async () => {
    mockFetch(record)

    await expect(thornameResolver.resolve({ name: 'vi.thor', chain: Chain.Litecoin })).resolves.toEqual({
      kind: 'noAddressForChain',
    })
  })

  it('reports a name THORNode says does not exist as not found', async () => {
    mockFetch({ code: 2, message: "fail to fetch THORName: THORName doesn't exist: nope", details: [] }, 500)

    await expect(thornameResolver.resolve({ name: 'nope.thor', chain: Chain.Bitcoin })).resolves.toEqual({
      kind: 'notFound',
    })
  })

  it('reports a 404 as not found', async () => {
    mockFetch({ message: 'not found' }, 404)

    await expect(thornameResolver.resolve({ name: 'nope.thor', chain: Chain.Bitcoin })).resolves.toEqual({
      kind: 'notFound',
    })
  })

  it('reports an expired name, which THORNode returns blank, as not found', async () => {
    mockFetch({ name: 'old', expire_block_height: 0, owner: '', aliases: [] })

    await expect(thornameResolver.resolve({ name: 'old.thor', chain: Chain.Bitcoin })).resolves.toEqual({
      kind: 'notFound',
    })
  })

  it('throws when THORNode cannot be reached instead of reporting the name missing', async () => {
    mockFetch({ message: 'upstream unavailable' }, 503)

    await expect(thornameResolver.resolve({ name: 'vi.thor', chain: Chain.Bitcoin })).rejects.toThrow(
      'upstream unavailable'
    )
  })

  it.each<[Chain, boolean]>([
    [Chain.THORChain, true],
    [Chain.Bitcoin, true],
    [Chain.BSC, true],
    [Chain.Dash, false],
    [Chain.Arbitrum, false],
    [Chain.MayaChain, false],
    [Chain.Polygon, false],
    [Chain.Near, false],
  ])('holds a %s address: %s', (chain, isSupported) => {
    expect(thornameResolver.isChainSupported(chain)).toBe(isSupported)
  })
})

describe('mayanameResolver', () => {
  it('looks the name up on MAYANode and picks the MAYA alias', async () => {
    const fetchMock = mockFetch({
      ...record,
      owner: 'maya1owner',
      aliases: [{ chain: 'MAYA', address: 'maya1alias' }],
    })

    await expect(mayanameResolver.resolve({ name: 'eld.maya', chain: Chain.MayaChain })).resolves.toEqual({
      kind: 'resolved',
      address: 'maya1alias',
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${nativeSwapApiBaseUrl[Chain.MayaChain]}/mayaname/eld`)
  })

  it("reports a name MAYANode says doesn't exist as not found", async () => {
    mockFetch({ code: 2, message: "MAYAName doesn't exist: nope", details: [] }, 500)

    await expect(mayanameResolver.resolve({ name: 'nope.maya', chain: Chain.Dash })).resolves.toEqual({
      kind: 'notFound',
    })
  })

  it.each<[Chain, boolean]>([
    [Chain.MayaChain, true],
    [Chain.THORChain, true],
    [Chain.Dash, true],
    [Chain.Arbitrum, true],
    [Chain.Bitcoin, true],
    [Chain.BSC, false],
    [Chain.Solana, false],
    [Chain.Polygon, false],
  ])('holds a %s address: %s', (chain, isSupported) => {
    expect(mayanameResolver.isChainSupported(chain)).toBe(isSupported)
  })
})
