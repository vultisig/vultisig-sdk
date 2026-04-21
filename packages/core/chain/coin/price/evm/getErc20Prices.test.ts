import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryCoingeickoPrices } = vi.hoisted(() => ({
  mockQueryCoingeickoPrices: vi.fn(),
}))

vi.mock('../queryCoingeickoPrices', () => ({
  queryCoingeickoPrices: mockQueryCoingeickoPrices,
}))

import { getErc20Prices } from './getErc20Prices'

describe('getErc20Prices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lowercases response keys so checksum-cased contract addresses resolve', async () => {
    const checksumAddr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    mockQueryCoingeickoPrices.mockResolvedValue({
      [checksumAddr]: 1,
    })

    const prices = await getErc20Prices({
      ids: [checksumAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[checksumAddr.toLowerCase()]).toBe(1)
  })
})
