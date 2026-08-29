import { toBech32 } from '@cosmjs/encoding'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRujiTradeSwapQuote, isRujiTradeSwapPair } from './getRujiTradeSwapQuote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

const address = 'thor1vk6trmz42cjrh4zcxczeaacnsv3snv4f22x8ccu203dqde7vtaxsyevlec'
const rune: AccountCoin = {
  chain: Chain.THORChain,
  address,
  ticker: 'RUNE',
  decimals: 8,
}
const brune: AccountCoin = {
  chain: Chain.THORChain,
  address,
  id: 'x/brune',
  ticker: 'bRUNE',
  decimals: 8,
}

const marketResponse = {
  data: {
    fin: [
      {
        address,
        assetBase: { asset: 'x/brune' },
        assetQuote: { asset: 'THOR.RUNE' },
      },
    ],
  },
}

const decodeSmartQuery = (url: string): unknown => {
  const encoded = url.split('/smart/')[1]
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}

describe('getRujiTradeSwapQuote', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it.each([
    { label: 'RUNE → bRUNE', from: rune, to: brune, denom: 'rune' },
    { label: 'bRUNE → RUNE', from: brune, to: rune, denom: 'x/brune' },
  ])('builds a guarded FIN CosmWasm route for $label', async ({ from, to, denom }) => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce(marketResponse)
      .mockResolvedValueOnce({ data: { denoms: ['x/brune', 'rune'] } })
      .mockResolvedValueOnce({ data: { returned: '998124', fee: '1500' } })

    const quote = await getRujiTradeSwapQuote({
      from,
      to,
      amount: 1_000_000n,
      destination: address,
      slippageBps: 250,
    })

    expect(quote.provider).toBe('ruji')
    expect(quote.dstAmount).toBe('998124')
    expect(quote.tx).toEqual({
      cosmosWasm: {
        sender: address,
        contract: address,
        executeMsg: JSON.stringify({
          swap: { min: { min_return: '973170', to: address } },
        }),
        funds: [{ denom, amount: '1000000' }],
      },
    })

    expect(decodeSmartQuery(String(vi.mocked(queryUrl).mock.calls[1][0]))).toEqual({ config: {} })
    expect(decodeSmartQuery(String(vi.mocked(queryUrl).mock.calls[2][0]))).toEqual({
      simulate: { denom, amount: '1000000' },
    })
  })

  it('fails closed when discovery points at a contract whose denoms are not the bRUNE/RUNE pair', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce(marketResponse)
      .mockResolvedValueOnce({ data: { denoms: ['x/brune', 'x/ruji'] } })
      .mockResolvedValueOnce({ data: { returned: '998124', fee: '1500' } })

    await expect(
      getRujiTradeSwapQuote({ from: rune, to: brune, amount: 1_000_000n, destination: address })
    ).rejects.toThrow('contract config does not match')
  })

  it('fails closed when discovery returns duplicate FIN denominations', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce(marketResponse)
      .mockResolvedValueOnce({ data: { denoms: ['rune', 'rune'] } })
      .mockResolvedValueOnce({ data: { returned: '998124', fee: '1500' } })

    await expect(
      getRujiTradeSwapQuote({ from: rune, to: brune, amount: 1_000_000n, destination: address })
    ).rejects.toThrow('contract config does not match')
  })

  it('fails closed when discovery returns a valid but untrusted FIN contract', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      data: { fin: [{ ...marketResponse.data.fin[0], address: 'thor12a9rpf9u2ulwuezxkh6uas4au7xnde8umdua5t' }] },
    })

    await expect(
      getRujiTradeSwapQuote({ from: rune, to: brune, amount: 1_000_000n, destination: address })
    ).rejects.toThrow('untrusted RUNE ↔ bRUNE FIN contract')
  })

  it('selects the pinned market when an untrusted pair match is returned first', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          fin: [
            { ...marketResponse.data.fin[0], address: 'thor12a9rpf9u2ulwuezxkh6uas4au7xnde8umdua5t' },
            marketResponse.data.fin[0],
          ],
        },
      })
      .mockResolvedValueOnce({ data: { denoms: ['x/brune', 'rune'] } })
      .mockResolvedValueOnce({ data: { returned: '998124', fee: '1500' } })

    await expect(
      getRujiTradeSwapQuote({ from: rune, to: brune, amount: 1_000_000n, destination: address })
    ).resolves.toMatchObject({ tx: { cosmosWasm: { contract: address } } })
  })

  it('normalizes validated THORChain addresses before building the route', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: { fin: [{ ...marketResponse.data.fin[0], address: ` ${address} ` }] },
      })
      .mockResolvedValueOnce({ data: { denoms: ['x/brune', 'rune'] } })
      .mockResolvedValueOnce({ data: { returned: '998124', fee: '1500' } })

    const quote = await getRujiTradeSwapQuote({
      from: { ...rune, address: ` ${address} ` },
      to: brune,
      amount: 1_000_000n,
      destination: ` ${address} `,
    })

    expect(quote.tx).toMatchObject({
      cosmosWasm: {
        sender: address,
        contract: address,
        executeMsg: JSON.stringify({ swap: { min: { min_return: '988142', to: address } } }),
      },
    })
  })

  it('recognizes only the two supported THORChain assets', () => {
    expect(isRujiTradeSwapPair(rune, brune)).toBe(true)
    expect(isRujiTradeSwapPair(brune, rune)).toBe(true)
    expect(
      isRujiTradeSwapPair(rune, {
        ...brune,
        id: 'x/ruji',
        ticker: 'RUJI',
      })
    ).toBe(false)
  })

  it('rejects a checksummed THOR address with a noncanonical payload length', async () => {
    const invalidAddress = toBech32('thor', new Uint8Array(10).fill(1))

    await expect(
      getRujiTradeSwapQuote({
        from: { ...rune, address: invalidAddress },
        to: brune,
        amount: 1_000_000n,
        destination: address,
      })
    ).rejects.toThrow('sender must be a valid THORChain address')
  })
})
