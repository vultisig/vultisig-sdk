import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CowSwapOrder } from '../sign/buildCowSwapOrder'
import { submitCowSwapOrder } from './submitCowSwapOrder'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

const order: CowSwapOrder = {
  sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  receiver: '0xreceiver',
  sellAmount: '1000000000000000000',
  buyAmount: '990000000',
  validTo: 1_800_000_000,
  appData: '{}',
  appDataHash: '0xapp',
  feeAmount: '0',
  kind: 'sell',
  partiallyFillable: false,
  sellTokenBalance: 'erc20',
  buyTokenBalance: 'erc20',
}

describe('submitCowSwapOrder', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it('POSTs the signed EIP-712 order and returns the order uid', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce('0xorderuid')

    await expect(
      submitCowSwapOrder({
        apiBase: 'https://api.cow.fi/mainnet',
        order,
        signature: '0xsig',
        from: '0xAbCDEF0000000000000000000000000000000001',
      })
    ).resolves.toBe('0xorderuid')

    expect(queryUrl).toHaveBeenCalledWith('https://api.cow.fi/mainnet/api/v1/orders', {
      method: 'POST',
      body: {
        ...order,
        signature: '0xsig',
        signingScheme: 'eip712',
        from: '0xabcdef0000000000000000000000000000000001',
      },
    })
  })
})
