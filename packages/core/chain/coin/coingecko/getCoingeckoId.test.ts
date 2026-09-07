import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

import { getSolanaCoingeckoIds } from './getCoingeckoId'

const entry = (address: string, coingecko_coin_id: string | null) => ({
  id: `solana_${address}`,
  type: 'token' as const,
  attributes: { address, coingecko_coin_id },
})

describe('getSolanaCoingeckoIds', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('asks for every mint in one multi-token call and keys the ids by mint', async () => {
    queryUrlMock.mockResolvedValue({ data: [entry('Alpha', 'usd-coin'), entry('Beta', null)] })

    const ids = await getSolanaCoingeckoIds(['Alpha', 'Beta', 'Alpha'])

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
    expect(queryUrlMock.mock.calls[0][0]).toMatch(/\/onchain\/networks\/solana\/tokens\/multi\/Alpha,Beta$/)
    expect(ids).toEqual({ Alpha: 'usd-coin' })
  })

  it('splits more than thirty mints across calls', async () => {
    const mints = Array.from({ length: 31 }, (_, index) => `mint${index}`)
    queryUrlMock.mockImplementation(async (url: string) => ({
      data: url
        .split('/multi/')[1]
        .split(',')
        .map(address => entry(address, `${address}-id`)),
    }))

    const ids = await getSolanaCoingeckoIds(mints)

    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(ids)).toHaveLength(31)
  })

  it('leaves out mints CoinGecko does not index', async () => {
    queryUrlMock.mockResolvedValue({ data: [] })

    await expect(getSolanaCoingeckoIds(['Alpha'])).resolves.toEqual({})
  })

  it('keys the result by the mint as requested, whatever case CoinGecko echoes back', async () => {
    queryUrlMock.mockResolvedValue({ data: [entry('abc', 'some-coin')] })

    await expect(getSolanaCoingeckoIds(['AbC'])).resolves.toEqual({ AbC: 'some-coin' })
  })

  it('makes no request for an empty list', async () => {
    await expect(getSolanaCoingeckoIds([])).resolves.toEqual({})
    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('propagates a failed lookup instead of reporting no id', async () => {
    queryUrlMock.mockRejectedValue(new Error('timeout'))

    await expect(getSolanaCoingeckoIds(['Alpha'])).rejects.toThrow('timeout')
  })
})
