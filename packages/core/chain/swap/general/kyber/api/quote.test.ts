import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it, vi } from 'vitest'

import { kyberSwapAffiliateConfig } from '../config'
import { getKyberSwapQuote } from './quote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

describe('getKyberSwapQuote', () => {
  it('passes affiliate fee params to route and build requests', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          routeSummary: { amountOut: '10000000' },
          routerAddress: '0xrouter',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          amountOut: '10000000',
          data: '0xswap',
          gas: '210000',
          routerAddress: '0xrouter',
        },
      })

    const quote = await getKyberSwapQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xsrc',
        decimals: 18,
        ticker: 'SRC',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xdst',
        decimals: 6,
        ticker: 'DST',
      },
      amount: 1_000_000n,
      affiliateBps: 50,
    })

    const [routeUrl, routeOptions] = vi.mocked(queryUrl).mock.calls[0]
    expect(routeUrl).toContain('feeAmount=50')
    expect(routeUrl).toContain('chargeFeeBy=currency_out')
    expect(routeUrl).toContain('isInBps=true')
    expect(routeUrl).toContain(`feeReceiver=${kyberSwapAffiliateConfig.referral}`)
    expect(routeOptions).toMatchObject({
      headers: { 'X-Client-Id': kyberSwapAffiliateConfig.source },
    })

    const [, buildOptions] = vi.mocked(queryUrl).mock.calls[1]
    expect(buildOptions?.body).toMatchObject({
      source: kyberSwapAffiliateConfig.source,
      referral: kyberSwapAffiliateConfig.referral,
      feeAmount: 50,
      chargeFeeBy: 'currency_out',
      isInBps: true,
      feeReceiver: kyberSwapAffiliateConfig.referral,
    })

    expect('evm' in quote.tx ? quote.tx.evm.affiliateFee : undefined).toEqual({
      chain: Chain.Ethereum,
      id: '0xdst',
      decimals: 6,
      amount: 50_251n,
    })
  })
})
