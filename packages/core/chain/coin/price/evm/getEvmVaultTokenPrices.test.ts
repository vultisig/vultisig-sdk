import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadContract, mockGetCoinPrices } = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  mockGetCoinPrices: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ readContract: mockReadContract }),
}))

vi.mock('../getCoinPrices', () => ({
  getCoinPrices: mockGetCoinPrices,
}))

import { getEvmVaultTokenPrices } from './getEvmVaultTokenPrices'

const vthorAddr = '0x815c23eca83261b6ec689b60cc4a58b54bc24d8d'
const thorAddr = '0xa5f2211b9b8170f694421f2046281775e8468044'

describe('getEvmVaultTokenPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prices a vault receipt by redemption value: underlying price x balance / supply', async () => {
    mockReadContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'balanceOf' ? 4000n * 10n ** 18n : 1000n * 10n ** 18n
    )
    mockGetCoinPrices.mockResolvedValue({ thorswap: 0.04 })

    const prices = await getEvmVaultTokenPrices({
      ids: ['0x815C23eCA83261b6Ec689b60Cc4a58b54BC24D8D'],
      chain: EvmChain.Ethereum,
      fiatCurrency: 'usd',
    })

    // 4 THOR per vTHOR at $0.04 = $0.16
    expect(prices[vthorAddr]).toBeCloseTo(0.16)
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'balanceOf', address: thorAddr, args: [vthorAddr] })
    )
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'totalSupply', address: vthorAddr })
    )
  })

  it('ignores contracts that are not registered vault receipts', async () => {
    const prices = await getEvmVaultTokenPrices({
      ids: ['0x1111111111111111111111111111111111111111'],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({})
    expect(mockReadContract).not.toHaveBeenCalled()
  })

  it('omits a vault whose on-chain reads fail so callers can fall back', async () => {
    mockReadContract.mockRejectedValue(new Error('rpc down'))
    mockGetCoinPrices.mockResolvedValue({ thorswap: 0.04 })

    const prices = await getEvmVaultTokenPrices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({})
  })

  it('omits a vault when the underlying quote is missing or the supply is zero', async () => {
    mockReadContract.mockResolvedValue(0n)
    mockGetCoinPrices.mockResolvedValue({})

    const prices = await getEvmVaultTokenPrices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({})
  })
})
