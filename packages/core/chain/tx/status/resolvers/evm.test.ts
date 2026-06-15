import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    getTransactionReceipt: mocks.getTransactionReceipt,
  }),
}))

import { Chain } from '../../../Chain'
import { getEvmTxStatus } from './evm'

describe('getEvmTxStatus', () => {
  const hash = '0xabc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns isKnown:false when the receipt RPC fails', async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new Error('rpc down'))

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false when the hash is not indexed yet', async () => {
    mocks.getTransactionReceipt.mockResolvedValue(null)

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns success with fee receipt when the tx succeeded', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 21_000n,
      effectiveGasPrice: 2_000_000_000n,
    })

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({
      status: 'success',
      receipt: {
        feeAmount: 42_000_000_000_000n,
        feeDecimals: 18,
        feeTicker: 'ETH',
      },
    })
  })
})
