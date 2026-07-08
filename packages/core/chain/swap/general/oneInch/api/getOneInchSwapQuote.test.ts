import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it, vi } from 'vitest'

import { getOneInchSwapQuote } from './getOneInchSwapQuote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

const account = { chain: Chain.Ethereum, address: '0xsender' }

describe('getOneInchSwapQuote — AGG-02 router allowlist', () => {
  it('REJECTS a response whose tx.to is not the real 1inch router (spoofed/compromised aggregator)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: '0x000000000000000000000000000000deadbeef', // NOT 1inch's router
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    await expect(
      getOneInchSwapQuote({
        account,
        fromCoinId: '0xsrc',
        toCoinId: '0xdst',
        amount: 1_000_000n,
      })
    ).rejects.toThrow(/unrecognized router address/)
  })

  it('accepts a response whose tx.to is the real 1inch V6 router', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: '0x111111125421ca6dc452d289314280a0f8842a65', // real 1inch V6 router
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    const quote = await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      amount: 1_000_000n,
    })

    expect('evm' in quote.tx ? quote.tx.evm.to : undefined).toBe('0x111111125421ca6dc452d289314280a0f8842a65')
  })
})
