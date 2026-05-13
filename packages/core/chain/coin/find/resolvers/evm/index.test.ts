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

  it('propagates non-NoDataError from on-chain metadata fallback', async () => {
    const address = '0x5555555555555555555555555555555555555555'
    const tokenAddress = '0x6666666666666666666666666666666666666666'

    queryOneInchMock
      .mockResolvedValueOnce({
        [tokenAddress]: '1',
      })
      .mockResolvedValueOnce({})
    getEvmTokenMetadataMock.mockRejectedValueOnce(new Error('rpc down'))

    await expect(
      findEvmCoins({
        chain: EvmChain.Optimism,
        address,
      })
    ).rejects.toThrow('rpc down')
  })
})
