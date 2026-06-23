import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetBalance = vi.fn()
const mockReadContract = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getBalance: mockGetBalance, readContract: mockReadContract }),
}))

import { getEvmBalances } from '@/tools/evm/balanceEvm'

const HOLDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

describe('getEvmBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns native-only when no tokens are passed', async () => {
    mockGetBalance.mockResolvedValueOnce(1_500_000_000_000_000_000n) // 1.5 ETH

    const result = await getEvmBalances('Ethereum', { address: HOLDER })

    expect(result).toEqual([{ symbol: 'ETH', decimals: 18, raw: 1_500_000_000_000_000_000n, balance: '1.5' }])
    expect(mockGetBalance).toHaveBeenCalledTimes(1)
    expect(mockReadContract).not.toHaveBeenCalled()
  })

  it('reads native + ERC-20 (balanceOf/decimals/symbol) in one pass', async () => {
    mockGetBalance.mockResolvedValueOnce(0n)
    mockReadContract
      .mockResolvedValueOnce(500_000n) // balanceOf -> 0.5 USDC
      .mockResolvedValueOnce(6) // decimals
      .mockResolvedValueOnce('USDC') // symbol

    const result = await getEvmBalances('Ethereum', { address: HOLDER, tokens: [USDC] })

    expect(result).toEqual([
      { symbol: 'ETH', decimals: 18, raw: 0n, balance: '0' },
      { contractAddress: USDC, symbol: 'USDC', decimals: 6, raw: 500_000n, balance: '0.5' },
    ])
    expect(mockReadContract).toHaveBeenCalledTimes(3)
  })

  it('formats sub-unit balances without precision loss', async () => {
    mockGetBalance.mockResolvedValueOnce(1n) // 1 wei

    const [native] = await getEvmBalances('Ethereum', { address: HOLDER })

    expect(native.balance).toBe('0.000000000000000001')
    expect(native.raw).toBe(1n)
  })

  it('uses the chain native ticker (BNB on BSC)', async () => {
    mockGetBalance.mockResolvedValueOnce(0n)

    const [native] = await getEvmBalances('BSC', { address: HOLDER })

    expect(native.symbol).toBe('BNB')
    expect(native.decimals).toBe(18)
  })
})
