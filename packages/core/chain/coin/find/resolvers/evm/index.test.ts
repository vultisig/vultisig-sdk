import { beforeEach, describe, expect, it, vi } from 'vitest'

const getErc20BalanceMock = vi.hoisted(() => vi.fn())
const getEvmTokenMetadataMock = vi.hoisted(() => vi.fn())
const queryOneInchMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Balance', () => ({
  getErc20Balance: (...args: unknown[]) => getErc20BalanceMock(...args),
}))

vi.mock('@vultisig/core-chain/coin/find/resolvers/evm/queryOneInch', () => ({
  queryOneInch: (...args: unknown[]) => queryOneInchMock(...args),
}))

vi.mock('@vultisig/core-chain/coin/token/metadata/resolvers/evm', () => ({
  getEvmTokenMetadata: (...args: unknown[]) => getEvmTokenMetadataMock(...args),
}))

import { EvmChain } from '@vultisig/core-chain/Chain'
import { NoDataError } from '@vultisig/lib-utils/error/NoDataError'

import { findEvmCoins } from './index'

describe('findEvmCoins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getErc20BalanceMock.mockResolvedValue(0n)
  })

  it('discovers non-zero ERC-20 balances even without logo or CoinGecko provider metadata', async () => {
    const address = '0x1111111111111111111111111111111111111111'
    const tokenAddress = '0x2222222222222222222222222222222222222222'

    queryOneInchMock
      .mockResolvedValueOnce({
        [tokenAddress]: '1000000',
      })
      .mockResolvedValueOnce({
        [tokenAddress]: {
          address: tokenAddress,
          symbol: 'MYST',
          decimals: 6,
          name: 'Mystery Token',
          eip2612: false,
          tags: [],
          providers: ['OtherProvider'],
        },
      })

    await expect(
      findEvmCoins({
        chain: EvmChain.Ethereum,
        address,
      })
    ).resolves.toEqual([
      {
        chain: EvmChain.Ethereum,
        id: tokenAddress,
        decimals: 6,
        logo: undefined,
        ticker: 'MYST',
        address,
      },
    ])

    expect(getEvmTokenMetadataMock).not.toHaveBeenCalled()
  })

  it('falls back to on-chain metadata when OneInch has a balance but no token metadata', async () => {
    const address = '0x3333333333333333333333333333333333333333'
    const tokenAddress = '0x4444444444444444444444444444444444444444'

    queryOneInchMock
      .mockResolvedValueOnce({
        [tokenAddress]: '1',
      })
      .mockRejectedValueOnce(new NoDataError())
    getEvmTokenMetadataMock.mockResolvedValue({
      decimals: 18,
      ticker: 'FALLBACK',
    })

    await expect(
      findEvmCoins({
        chain: EvmChain.Base,
        address,
      })
    ).resolves.toEqual([
      {
        chain: EvmChain.Base,
        id: tokenAddress,
        decimals: 18,
        ticker: 'FALLBACK',
        address,
      },
    ])

    expect(getEvmTokenMetadataMock).toHaveBeenCalledWith({
      chain: EvmChain.Base,
      id: tokenAddress,
    })
  })

  it('does NOT abort discovery when the metadata batch fails with a 414 (falls back per-token)', async () => {
    // Regression: a token-rich wallet made the single ?addresses=... metadata
    // request overflow the URI limit -> HTTP 414 -> the whole chain's token
    // discovery threw, so even a held USDC balance came back "unable to
    // retrieve". The batch is now non-fatal and degrades to per-token metadata.
    const address = '0x7777777777777777777777777777777777777777'
    const tokenAddress = '0x8888888888888888888888888888888888888888'

    queryOneInchMock
      .mockResolvedValueOnce({ [tokenAddress]: '1000000' }) // balances
      .mockRejectedValueOnce(new Error('HTTP 414 URI Too Long')) // metadata batch dies
    getEvmTokenMetadataMock.mockResolvedValue({ decimals: 6, ticker: 'USDC' })

    await expect(findEvmCoins({ chain: EvmChain.Ethereum, address })).resolves.toEqual([
      { chain: EvmChain.Ethereum, id: tokenAddress, decimals: 6, ticker: 'USDC', address },
    ])
    expect(getEvmTokenMetadataMock).toHaveBeenCalledWith({ chain: EvmChain.Ethereum, id: tokenAddress })
  })

  it('chunks the metadata lookup into batches of 50 for a token-rich wallet', async () => {
    const address = '0x9999999999999999999999999999999999999999'
    // 60 held tokens -> ceil(60/50) = 2 metadata batches (never one giant URI).
    const tokenAddresses = Array.from({ length: 60 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`)
    const balances: Record<string, string> = {}
    const metadata: Record<string, unknown> = {}
    for (const a of tokenAddresses) {
      balances[a] = '1000000'
      metadata[a] = { address: a, symbol: 'TKN', decimals: 6, name: 'T', eip2612: false, tags: [], providers: [] }
    }

    queryOneInchMock.mockResolvedValueOnce(balances) // balances
    // Each metadata batch returns only its own slice.
    queryOneInchMock.mockImplementation(async (url: string) => {
      const m = /addresses=([^&]+)/.exec(url)
      if (!m) return {}
      const slice: Record<string, unknown> = {}
      for (const a of m[1]!.split(',')) slice[a] = metadata[a]
      return slice
    })

    const coins = await findEvmCoins({ chain: EvmChain.Ethereum, address })

    expect(coins).toHaveLength(60)
    // 1 balances call + 2 metadata batches.
    const metadataCalls = queryOneInchMock.mock.calls.filter(([u]) => String(u).includes('/token/'))
    expect(metadataCalls).toHaveLength(2)
    for (const [u] of metadataCalls) {
      // No single URI carries all 60 addresses.
      expect((String(u).match(/0x/g) ?? []).length).toBeLessThanOrEqual(50)
    }
    expect(getEvmTokenMetadataMock).not.toHaveBeenCalled()
  })

  it('discovers tokens on Zksync (1inch-supported) instead of short-circuiting to []', async () => {
    const address = '0xaaaAAAaaAAAAaaAAAAaAaaAaaAAaaaAaAAaAaAaA'
    const tokenAddress = '0xbBBbbBBbBbBBBBBbbBBbBbbBBbBbbbBBBBbBbBBB'

    queryOneInchMock.mockResolvedValueOnce({ [tokenAddress]: '1000000' }).mockResolvedValueOnce({
      [tokenAddress]: {
        address: tokenAddress,
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
        eip2612: false,
        tags: [],
        providers: [],
      },
    })

    await expect(findEvmCoins({ chain: EvmChain.Zksync, address })).resolves.toEqual([
      { chain: EvmChain.Zksync, id: tokenAddress, decimals: 6, logo: undefined, ticker: 'USDC', address },
    ])
    // Regression: previously findEvmCoins returned [] for Zksync WITHOUT any
    // network call because it wasn't in oneInchSupportedChains.
    expect(queryOneInchMock).toHaveBeenCalled()
    // Lock the chainId mapping: Zksync MUST resolve to 1inch chain 324 (viem zksync.id). Asserting only
    // "a 1inch call happened" would stay green if Zksync were later remapped to the wrong chain's endpoint
    // (wrong-chain token contracts). Pin the actual /324/ balance + token-custom URLs.
    const urls = queryOneInchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.includes('/balance/v1.2/324/'))).toBe(true)
    expect(urls.some(u => u.includes('/token/v1.2/324/custom'))).toBe(true)
  })

  it('skips a token whose on-chain metadata lookup fails transiently, keeping the rest', async () => {
    // Both tokens hold a balance and neither is in the 1inch metadata response,
    // so both fall to the on-chain getEvmTokenMetadata path. One RPC read fails
    // transiently; discovery must still return the other token rather than
    // rejecting the whole batch (which would surface as "unable to retrieve
    // your balances" for every token on the chain).
    const address = '0x5555555555555555555555555555555555555555'
    const failing = '0x6666666666666666666666666666666666666666'
    const surviving = '0x7777777777777777777777777777777777777777'

    queryOneInchMock
      .mockResolvedValueOnce({
        [failing]: '1',
        [surviving]: '2',
      })
      .mockResolvedValueOnce({})
    getEvmTokenMetadataMock.mockImplementation(async ({ id }: { id: string }) => {
      if (id === failing) throw new Error('rpc down')
      return { decimals: 18, ticker: 'OK', logo: undefined }
    })

    const result = await findEvmCoins({ chain: EvmChain.Optimism, address })

    expect(result).toEqual([
      { chain: EvmChain.Optimism, id: surviving, address, decimals: 18, ticker: 'OK', logo: undefined },
    ])
  })
})
