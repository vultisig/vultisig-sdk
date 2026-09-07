import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { makeSolanaVerifiedTokenRegistry } from '@vultisig/core-chain/chains/solana/spl/verifiedRegistry'
import { SolanaJupiterToken } from '@vultisig/core-chain/coin/jupiter/token'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSplAccountsMock = vi.hoisted(() => vi.fn())
const getJupiterTokensMock = vi.hoisted(() => vi.fn())
const getSolanaVerifiedTokenRegistryMock = vi.hoisted(() => vi.fn())
const getSolanaCoingeckoIdsMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/solana/spl/getSplAccounts', () => ({
  getSplAccounts: (...args: unknown[]) => getSplAccountsMock(...args),
}))

vi.mock('@vultisig/core-chain/coin/jupiter/api', () => ({
  getJupiterTokens: (...args: unknown[]) => getJupiterTokensMock(...args),
}))

vi.mock('@vultisig/core-chain/chains/solana/spl/verifiedRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/solana/spl/verifiedRegistry')>()),
  getSolanaVerifiedTokenRegistry: () => getSolanaVerifiedTokenRegistryMock(),
}))

vi.mock('@vultisig/core-chain/coin/coingecko/getCoingeckoId', () => ({
  getSolanaCoingeckoIds: (...args: unknown[]) => getSolanaCoingeckoIdsMock(...args),
}))

import { findSolanaCoins } from './index'

const ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const JLUSDC = '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D'
const FAKE_USDT = 'HBiHPHC6JFCE3cfCrERiFnJUVTzGErhZm9RmsTtzDJUb'
const MEME = 'Meme11111111111111111111111111111111111111111'
const UNINDEXED = 'Unindexed11111111111111111111111111111111111'

const registry = makeSolanaVerifiedTokenRegistry([
  { address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: 'usdc' },
  { address: JUP, symbol: 'JUP', name: 'Jupiter', decimals: 6, logo: 'https://static.jup.ag/jup/icon.png' },
  { address: JLUSDC, symbol: 'jlUSDC', name: 'Jupiter Lend USDC', decimals: 6, logo: 'https://list/jlusdc.png' },
])

const account = (mint: string, amount: string, decimals: number) => ({
  pubkey: {},
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
})

const accounts = () => [
  account(USDC, '14539900', 6),
  account(JLUSDC, '5000000', 6),
  account(FAKE_USDT, '100000000000', 8),
  account(MEME, '1', 9),
  account(UNINDEXED, '7', 0),
  account(JUP, '0', 6),
]

const jupiterTokens = (): Record<string, SolanaJupiterToken> => ({
  [USDC]: { id: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: 'https://jup/usdc.png', isVerified: true },
  [JLUSDC]: {
    id: JLUSDC,
    symbol: 'jlUSDC',
    name: 'Jupiter Lend USDC',
    decimals: 6,
    icon: 'https://jup/jlusdc.png',
    isVerified: true,
  },
  [FAKE_USDT]: { id: FAKE_USDT, symbol: 'USDT', name: 'Tether USD', decimals: 8, isVerified: null },
  [MEME]: { id: MEME, symbol: 'MEME', name: 'Meme', decimals: 9, isVerified: null },
})

const find = () => findSolanaCoins({ chain: OtherChain.Solana, address: ADDRESS })

describe('findSolanaCoins', () => {
  beforeEach(() => {
    getSplAccountsMock.mockReset().mockResolvedValue(accounts())
    getJupiterTokensMock.mockReset().mockResolvedValue(jupiterTokens())
    getSolanaVerifiedTokenRegistryMock.mockReset().mockResolvedValue(registry)
    getSolanaCoingeckoIdsMock.mockReset().mockResolvedValue({})
  })

  it('returns verified mints only, dropping the counterfeit, the unlisted and the unindexed holdings', async () => {
    const coins = await find()

    expect(getSplAccountsMock).toHaveBeenCalledWith(ADDRESS)
    expect(coins.map(coin => coin.id)).toEqual([USDC, JLUSDC])
  })

  it('looks every non-zero mint up in one Jupiter call, leaving out emptied accounts', async () => {
    await find()

    expect(getJupiterTokensMock).toHaveBeenCalledTimes(1)
    expect(getJupiterTokensMock).toHaveBeenCalledWith([USDC, JLUSDC, FAKE_USDT, MEME, UNINDEXED])
  })

  it('looks price ids up once, for the verified mints we do not curate ourselves', async () => {
    await find()

    expect(getSolanaCoingeckoIdsMock).toHaveBeenCalledTimes(1)
    expect(getSolanaCoingeckoIdsMock).toHaveBeenCalledWith([JLUSDC])
  })

  it('fails the round when the price id lookup fails, rather than saving tokens unpriced', async () => {
    getSolanaCoingeckoIdsMock.mockRejectedValue(new Error('timeout'))

    await expect(find()).rejects.toThrow('timeout')
  })

  it('uses curated metadata for tokens we ship ourselves', async () => {
    const [usdc] = await find()

    expect(usdc).toEqual({
      chain: Chain.Solana,
      id: USDC,
      address: ADDRESS,
      ticker: 'USDC',
      decimals: 6,
      logo: 'usdc',
      priceProviderId: 'usd-coin',
    })
  })

  it('builds Jupiter-verified tokens from Jupiter metadata, with a CoinGecko id when one exists', async () => {
    getSolanaCoingeckoIdsMock.mockResolvedValue({ [JLUSDC]: 'jupiter-lend-usdc' })

    const [, jlusdc] = await find()

    expect(jlusdc).toEqual({
      chain: Chain.Solana,
      id: JLUSDC,
      address: ADDRESS,
      ticker: 'jlUSDC',
      decimals: 6,
      logo: 'https://jup/jlusdc.png',
      priceProviderId: 'jupiter-lend-usdc',
    })
  })

  it('keeps a verified token that has no price id', async () => {
    const [, jlusdc] = await find()

    expect(jlusdc).toEqual({
      chain: Chain.Solana,
      id: JLUSDC,
      address: ADDRESS,
      ticker: 'jlUSDC',
      decimals: 6,
      logo: 'https://jup/jlusdc.png',
    })
  })

  it('takes decimals from the token account rather than the indexer', async () => {
    getSplAccountsMock.mockResolvedValue([account(JLUSDC, '5', 9)])

    const [jlusdc] = await find()

    expect(jlusdc.decimals).toBe(9)
  })

  it('falls back to registry metadata when Jupiter has no entry for a listed mint', async () => {
    getSplAccountsMock.mockResolvedValue([account(JLUSDC, '5000000', 6)])
    getJupiterTokensMock.mockResolvedValue({})

    await expect(find()).resolves.toEqual([
      {
        chain: Chain.Solana,
        id: JLUSDC,
        address: ADDRESS,
        ticker: 'jlUSDC',
        decimals: 6,
        logo: 'https://list/jlusdc.png',
      },
    ])
  })

  it("trusts Jupiter's own verified flag when the registry has degraded to the curated list", async () => {
    getSolanaVerifiedTokenRegistryMock.mockResolvedValue(
      makeSolanaVerifiedTokenRegistry([{ address: USDC, symbol: 'USDC', decimals: 6, logo: 'usdc' }])
    )

    const coins = await find()

    expect(coins.map(coin => coin.id)).toEqual([USDC, JLUSDC])
  })

  it('discovers a mint held in several token accounts once', async () => {
    getSplAccountsMock.mockResolvedValue([account(USDC, '1', 6), account(USDC, '2', 6)])

    const coins = await find()

    expect(coins.map(coin => coin.id)).toEqual([USDC])
    expect(getJupiterTokensMock).toHaveBeenCalledWith([USDC])
  })

  it('returns nothing, without asking Jupiter, for a wallet with no token balances', async () => {
    getSplAccountsMock.mockResolvedValue([account(JUP, '0', 6)])

    await expect(find()).resolves.toEqual([])
    expect(getJupiterTokensMock).not.toHaveBeenCalled()
    expect(getSolanaVerifiedTokenRegistryMock).not.toHaveBeenCalled()
    expect(getSolanaCoingeckoIdsMock).not.toHaveBeenCalled()
  })
})
