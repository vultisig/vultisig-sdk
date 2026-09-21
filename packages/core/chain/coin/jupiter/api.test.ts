import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

import { baseJupiterTokensUrl, getJupiterTokens, getJupiterVerifiedTokens } from './api'

const token = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  symbol: id.slice(0, 4).toUpperCase(),
  name: `Token ${id}`,
  decimals: 6,
  ...overrides,
})

describe('getJupiterTokens', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('asks for every mint in one comma-separated search and keys the result by mint', async () => {
    queryUrlMock.mockResolvedValue([token('Alpha'), token('Beta')])

    const tokens = await getJupiterTokens(['Alpha', 'Beta', 'Alpha'])

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
    expect(queryUrlMock).toHaveBeenCalledWith(`${baseJupiterTokensUrl}/search?query=Alpha,Beta`)
    expect(tokens).toEqual({ Alpha: token('Alpha'), Beta: token('Beta') })
  })

  it('splits more than a hundred mints across calls', async () => {
    const mints = Array.from({ length: 101 }, (_, index) => `mint${index}`)
    queryUrlMock.mockImplementation(async (url: string) =>
      url
        .split('query=')[1]
        .split(',')
        .map(id => token(id))
    )

    const tokens = await getJupiterTokens(mints)

    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(tokens)).toHaveLength(101)
  })

  it('drops results for mints that were not asked about and skips malformed entries', async () => {
    queryUrlMock.mockResolvedValue([token('Alpha'), token('Lookalike'), { id: 42 }, { symbol: 'NOID' }, null])

    await expect(getJupiterTokens(['Alpha'])).resolves.toEqual({ Alpha: token('Alpha') })
  })

  it('drops partial entries rather than passing on a token without a name or decimals', async () => {
    queryUrlMock.mockResolvedValue([
      { id: 'NoDecimals', symbol: 'ND', name: 'No decimals' },
      { id: 'StringDecimals', symbol: 'SD', name: 'String decimals', decimals: '6' },
      { id: 'NoName', symbol: 'NN', decimals: 6 },
      token('EmptyName', { name: '' }),
    ])

    await expect(getJupiterTokens(['NoDecimals', 'StringDecimals', 'NoName', 'EmptyName'])).resolves.toEqual({
      EmptyName: token('EmptyName', { name: '' }),
    })
  })

  it('makes no request for an empty list', async () => {
    await expect(getJupiterTokens([])).resolves.toEqual({})
    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('rejects a response that is not a list', async () => {
    queryUrlMock.mockResolvedValue({ status: 400, message: 'Invalid query' })

    await expect(getJupiterTokens(['Alpha'])).rejects.toThrow(/token list/)
  })
})

describe('getJupiterVerifiedTokens', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('fetches the verified tag with a generous deadline', async () => {
    queryUrlMock.mockResolvedValue([token('Alpha', { isVerified: true }), { broken: true }])

    await expect(getJupiterVerifiedTokens()).resolves.toEqual([token('Alpha', { isVerified: true })])
    expect(queryUrlMock).toHaveBeenCalledWith(`${baseJupiterTokensUrl}/tag?query=verified`, {
      timeoutMs: expect.any(Number),
    })
  })

  it('rejects a payload that is not a list', async () => {
    queryUrlMock.mockResolvedValue({ status: 400, message: 'Invalid tag provided.' })

    await expect(getJupiterVerifiedTokens()).rejects.toThrow(/token list/)
  })
})
