import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadContract = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ readContract: mockReadContract }),
}))

import { evmCheckAllowance } from '@/tools/evm/checkAllowance'

describe('evmCheckAllowance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns allowance, decimals, and symbol', async () => {
    // Mock 3 sequential readContract calls
    mockReadContract
      .mockResolvedValueOnce(1000000n) // allowance
      .mockResolvedValueOnce(6) // decimals
      .mockResolvedValueOnce('USDC') // symbol

    const result = await evmCheckAllowance('Ethereum', {
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      owner: '0x000000000000000000000000000000000000dEaD',
      spender: '0x0000000000000000000000000000000000000001',
    })

    expect(result).toEqual({
      allowance: 1000000n,
      decimals: 6,
      symbol: 'USDC',
    })

    expect(mockReadContract).toHaveBeenCalledTimes(3)
  })

  it('returns zero allowance for unapproved tokens', async () => {
    mockReadContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(18).mockResolvedValueOnce('WETH')

    const result = await evmCheckAllowance('Ethereum', {
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      owner: '0x000000000000000000000000000000000000dEaD',
      spender: '0x0000000000000000000000000000000000000001',
    })

    expect(result.allowance).toBe(0n)
    expect(result.decimals).toBe(18)
    expect(result.symbol).toBe('WETH')
  })
})
