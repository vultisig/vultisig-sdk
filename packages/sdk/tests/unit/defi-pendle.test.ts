// Unit tests for sdk.defi.pendle (PT buy/sell/redeem builders).
//
// Network is mocked at the queryUrl boundary so these are hermetic. They assert
// the UNSIGNED-tx contract: correct REST URLs, chain-prefix stripping, router
// allow-listing, ERC20 approve encoding, injectable (default-off) affiliate,
// and the fail-closed redeem.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the SDK fetch primitive before importing the module under test.
const queryUrlMock = vi.fn()
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

import { defi } from '@/tools/defi'
import {
  buildBuyPt,
  buildRedeem,
  buildSellPt,
  isPendleChain,
  pendle,
  PENDLE_ROUTER_V4,
  pendleMarkets,
  stripChainPrefix,
} from '@/tools/defi/pendle'

// Ethereum (chainId 1) sample market + Convert fixtures.
// NOTE: these must be syntactically valid 20-byte 0x addresses — the builders
// fail-closed on a non-hex approval token / router, so placeholders like
// "0xMarket…" would (correctly) be rejected.
const MARKET = '0x1111111111111111111111111111111111110001'
const PT = '0x2222222222222222222222222222222222220002'
const UNDERLYING = '0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a000a0'
const FROM = '0xff00ff00ff00ff00ff00ff00ff00ff00ff0000ff'

const activeMarketsFixture = {
  markets: [
    {
      name: 'PT-USDC-26DEC2026',
      // API returns chain-id-prefixed addresses.
      address: `1-${MARKET}`,
      expiry: '2026-12-26T00:00:00.000Z',
      pt: `1-${PT}`,
      yt: '1-0xYT0000000000000000000000000000000000000b',
      sy: '1-0xSY0000000000000000000000000000000000000c',
      underlyingAsset: `1-${UNDERLYING}`,
      details: { liquidity: 12_000_000, impliedApy: 0.0812, underlyingApy: 0.05 },
    },
  ],
}

const convertFixture = {
  requiredApprovals: [{ token: UNDERLYING, amount: '1000000' }],
  routes: [
    {
      tx: { to: PENDLE_ROUTER_V4, data: '0xdeadbeef' },
      outputs: [{ token: `1-${PT}`, amount: '995000' }],
      data: { priceImpact: 0.0003, impliedApy: { after: 0.081 } },
      contractParamInfo: { method: 'swapExactTokenForPt' },
    },
  ],
}

function routeMockByUrl() {
  queryUrlMock.mockImplementation(async (url: string) => {
    if (url.includes('/markets/active')) return activeMarketsFixture
    if (url.includes('/sdk/') && url.includes('/convert')) return convertFixture
    throw new Error(`unexpected url ${url}`)
  })
}

beforeEach(() => {
  queryUrlMock.mockReset()
})

describe('sdk.defi.pendle helpers', () => {
  it('strips the {chainId}- prefix only when it is a chain id + 0x address', () => {
    expect(stripChainPrefix(`1-${PT}`)).toBe(PT)
    expect(stripChainPrefix('0xabc-def')).toBe('0xabc-def') // bare 0x with dash, untouched
    expect(stripChainPrefix(undefined)).toBe('')
  })

  it('exposes a namespace + supported-chain guard', () => {
    expect(isPendleChain('Ethereum')).toBe(true)
    expect(isPendleChain('Bitcoin')).toBe(false)
    expect(defi.pendle).toBe(pendle)
    expect(pendle.ROUTER_V4).toBe(PENDLE_ROUTER_V4)
  })
})

describe('pendleMarkets', () => {
  it('hits the correct REST path and strips prefixes', async () => {
    routeMockByUrl()
    const out = await pendleMarkets({ chain: 'Ethereum' })
    expect(queryUrlMock).toHaveBeenCalledWith('https://api-v2.pendle.finance/core/v1/1/markets/active')
    expect(out[0].market).toBe(MARKET)
    expect(out[0].pt).toBe(PT)
    expect(out[0].ptFixedApy).toBe(0.0812)
  })
})

describe('buildBuyPt (UNSIGNED)', () => {
  it('builds an unsigned router tx + approve leg, router allow-listed', async () => {
    routeMockByUrl()
    const res = await buildBuyPt({
      chain: 'Ethereum',
      market: MARKET,
      pt: PT,
      underlying: UNDERLYING,
      amount: '1000000',
      from: FROM,
    })
    expect(res.action).toBe('buy_pt')
    // Router leg is the pre-encoded Convert calldata, targeting Router V4.
    expect(res.tx.to).toBe(PENDLE_ROUTER_V4)
    expect(res.tx.data).toBe('0xdeadbeef')
    expect(res.tx.from).toBe(FROM)
    expect(res.tx.chainId).toBe(1)
    expect(res.tx.gasLimit).toBe('2000000')
    // Approve leg: ERC20 approve(router, amount), selector 0x095ea7b3.
    expect(res.approval).toBeDefined()
    expect(res.approval!.to).toBe(UNDERLYING)
    expect(res.approval!.data.startsWith('0x095ea7b3')).toBe(true)
    expect(res.approval!.data.toLowerCase()).toContain(PENDLE_ROUTER_V4.slice(2).toLowerCase())
    expect(res.steps.map(s => s.id)).toEqual(['approve', 'sign', 'broadcast'])
    expect(res.meta.expectedOutToken).toBe(PT) // prefix stripped
    expect(res.meta.note).toContain('UNSIGNED')
  })

  it('keeps the affiliate OFF by default and INJECTS it only when passed', async () => {
    routeMockByUrl()
    await buildBuyPt({
      chain: 'Ethereum',
      market: MARKET,
      pt: PT,
      underlying: UNDERLYING,
      amount: '1000000',
      from: FROM,
    })
    const defaultUrl = queryUrlMock.mock.calls.find(c => String(c[0]).includes('/convert'))![0] as string
    expect(defaultUrl).not.toContain('aggregatorReceiver')

    queryUrlMock.mockReset()
    routeMockByUrl()
    await buildBuyPt({
      chain: 'Ethereum',
      market: MARKET,
      pt: PT,
      underlying: UNDERLYING,
      amount: '1000000',
      from: FROM,
      affiliate: '0xAffiliate000000000000000000000000000000ee',
    })
    const injectedUrl = queryUrlMock.mock.calls.find(c => String(c[0]).includes('/convert'))![0] as string
    expect(injectedUrl).toContain('aggregatorReceiver=0xAffiliate000000000000000000000000000000ee')
  })

  it('refuses to build when the router is not Pendle Router V4', async () => {
    queryUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('/markets/active')) return activeMarketsFixture
      return { routes: [{ tx: { to: '0xEvilRouter00000000000000000000000000000000', data: '0x01' } }] }
    })
    await expect(
      buildBuyPt({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/unexpected router/)
  })

  it('refuses malformed router calldata (non-hex / too short)', async () => {
    queryUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('/markets/active')) return activeMarketsFixture
      return { routes: [{ tx: { to: PENDLE_ROUTER_V4, data: '0xzz' } }] }
    })
    await expect(
      buildBuyPt({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/malformed router calldata/)
  })

  it('refuses a non-numeric / hex-injected tx.value on native input', async () => {
    queryUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('/markets/active')) return activeMarketsFixture
      return { routes: [{ tx: { to: PENDLE_ROUTER_V4, data: '0xdeadbeef', value: '0xff' } }] }
    })
    await expect(
      buildBuyPt({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/invalid tx\.value/)
  })

  it('refuses an invalid approval token address from Convert', async () => {
    queryUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('/markets/active')) return activeMarketsFixture
      return {
        requiredApprovals: [{ token: '0xNOTANADDRESS', amount: '1000000' }],
        routes: [{ tx: { to: PENDLE_ROUTER_V4, data: '0xdeadbeef' } }],
      }
    })
    await expect(
      buildBuyPt({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/invalid approval token/)
  })

  it('refuses an out-of-bounds / non-decimal approval amount (no silent wrap)', async () => {
    const overflow = ((1n << 256n) + 5n).toString()
    queryUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('/markets/active')) return activeMarketsFixture
      return {
        requiredApprovals: [{ token: UNDERLYING, amount: overflow }],
        routes: [{ tx: { to: PENDLE_ROUTER_V4, data: '0xdeadbeef' } }],
      }
    })
    await expect(
      buildBuyPt({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/exceeds uint256 max/)
  })

  it('rejects a market/token mismatch', async () => {
    routeMockByUrl()
    await expect(
      buildBuyPt({
        chain: 'Ethereum',
        market: MARKET,
        pt: '0xWrongPt',
        underlying: UNDERLYING,
        amount: '1',
        from: FROM,
      })
    ).rejects.toThrow(/mismatch/)
  })
})

describe('buildSellPt (UNSIGNED)', () => {
  it('swaps PT → underlying', async () => {
    routeMockByUrl()
    const res = await buildSellPt({
      chain: 'Ethereum',
      market: MARKET,
      pt: PT,
      underlying: UNDERLYING,
      amount: '500000',
      from: FROM,
    })
    expect(res.action).toBe('sell_pt')
    const convertUrl = queryUrlMock.mock.calls.find(c => String(c[0]).includes('/convert'))![0] as string
    expect(convertUrl).toContain(`tokensIn=${PT}`)
    expect(convertUrl).toContain(`tokensOut=${UNDERLYING}`)
  })
})

describe('buildRedeem (fail-closed)', () => {
  it('refuses an active-market redeem (points to sell)', async () => {
    routeMockByUrl()
    await expect(
      buildRedeem({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/still active/)
  })

  it('refuses an expired/unknown market redeem (not enabled yet)', async () => {
    queryUrlMock.mockImplementation(async () => ({ markets: [] }))
    await expect(
      buildRedeem({ chain: 'Ethereum', market: MARKET, pt: PT, underlying: UNDERLYING, amount: '1', from: FROM })
    ).rejects.toThrow(/not enabled yet/)
  })
})
