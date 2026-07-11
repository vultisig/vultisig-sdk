import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { FindCoinsResolverInput } from '@vultisig/core-chain/coin/find/resolver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/ripple/client', () => ({
  getRippleClient: async () => ({ request: requestMock }),
}))

import { findRippleCoins } from './ripple'

const ADDRESS = 'rMwNibdiFaEzsTaFCG1NnmAM3Rv3vHUy5L'
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
const RLUSD_CURRENCY = '524C555344000000000000000000000000000000'

type TrustLine = { account: string; currency: string; balance: string }

const mockLines = (...pages: { lines: TrustLine[]; marker?: string }[]) => {
  const remaining = [...pages]

  requestMock.mockImplementation(async () => {
    const page = remaining.shift() ?? { lines: [] }

    return { result: { lines: page.lines, ...(page.marker ? { marker: page.marker } : {}) } }
  })
}

const input: FindCoinsResolverInput<OtherChain.Ripple> = {
  chain: OtherChain.Ripple,
  address: ADDRESS,
}

describe('findRippleCoins', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('discovers a held trust line as an AccountCoin', async () => {
    mockLines({ lines: [{ account: 'rIssuer', currency: 'USD', balance: '12.5' }] })

    await expect(findRippleCoins(input)).resolves.toEqual([
      {
        id: 'USD.rIssuer',
        chain: Chain.Ripple,
        address: ADDRESS,
        ticker: 'USD',
        decimals: 15,
      },
    ])
  })

  it('decodes a hex currency code back to its human ticker', async () => {
    mockLines({ lines: [{ account: 'rIssuer', currency: RLUSD_CURRENCY, balance: '1' }] })

    const [coin] = await findRippleCoins(input)

    expect(coin.ticker).toBe('RLUSD')
  })

  it('enriches a curated token with its logo and price provider', async () => {
    mockLines({
      lines: [{ account: RLUSD_ISSUER, currency: RLUSD_CURRENCY, balance: '5' }],
    })

    const [coin] = await findRippleCoins(input)

    expect(coin).toMatchObject({
      ticker: 'RLUSD',
      logo: 'rlusd',
      priceProviderId: 'ripple-usd',
      address: ADDRESS,
    })
  })

  it('excludes negative lines — the account issued the token, it does not hold it', async () => {
    mockLines({ lines: [{ account: 'rPeer', currency: 'USD', balance: '-42' }] })

    await expect(findRippleCoins(input)).resolves.toEqual([])
  })

  it('excludes zero-balance lines so empty trust lines do not clutter the asset list', async () => {
    mockLines({ lines: [{ account: 'rIssuer', currency: 'JPY', balance: '0' }] })

    await expect(findRippleCoins(input)).resolves.toEqual([])
  })

  it('follows pagination so a large trust-line set is not truncated', async () => {
    mockLines(
      { lines: [{ account: 'rIssuer1', currency: 'USD', balance: '1' }], marker: 'page-2' },
      { lines: [{ account: 'rIssuer2', currency: 'EUR', balance: '2' }] }
    )

    const coins = await findRippleCoins(input)

    expect(coins.map(({ id }) => id)).toEqual(['USD.rIssuer1', 'EUR.rIssuer2'])
  })

  it('returns no coins for an unfunded account instead of throwing', async () => {
    requestMock.mockRejectedValue(new Error('Account not found.'))

    await expect(findRippleCoins(input)).resolves.toEqual([])
  })

  it('propagates an unexpected ledger error rather than reporting an empty wallet', async () => {
    requestMock.mockRejectedValue(new Error('actMalformed'))

    await expect(findRippleCoins(input)).rejects.toThrow(/actMalformed/)
  })
})
