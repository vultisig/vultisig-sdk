import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDynamicPriorityFeePrice: vi.fn(),
  getKeysignCoin: vi.fn(),
  getLatestBlockhash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getLatestBlockhash: mocks.getLatestBlockhash,
  }),
}))

vi.mock('@vultisig/core-chain/chains/solana/getDynamicPriorityFeePrice', () => ({
  getDynamicPriorityFeePrice: mocks.getDynamicPriorityFeePrice,
}))

vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: mocks.getKeysignCoin,
}))

import { Chain } from '@vultisig/core-chain/Chain'
import { getSolanaChainSpecific } from '.'

describe('getSolanaChainSpecific', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLatestBlockhash.mockResolvedValue({ blockhash: 'confirmed-blockhash' })
    mocks.getDynamicPriorityFeePrice.mockResolvedValue(123n)
    mocks.getKeysignCoin.mockReturnValue({
      address: '7Zb1h3Z4vYtHk1qSQ9HAtpNQJ4T4r1CqWn2zPnyjF4Lt',
      chain: Chain.Solana,
    })
  })

  it('fetches the Solana signing blockhash at confirmed commitment', async () => {
    const result = await getSolanaChainSpecific({
      keysignPayload: {
        toAddress: '',
      },
    } as any)

    expect(mocks.getLatestBlockhash).toHaveBeenCalledWith('confirmed')
    expect(result.recentBlockHash).toBe('confirmed-blockhash')
  })
})
