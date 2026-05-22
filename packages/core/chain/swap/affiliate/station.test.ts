import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it, vi } from 'vitest'

import { stationKyberSwapAffiliateConfig } from '../general/kyber/stationConfig'
import { stationNativeSwapAffiliateConfig } from '../native/stationNativeSwapAffiliateConfig'
import { stationOneInchAffiliateConfig } from '../general/oneInch/stationOneInchAffiliateConfig'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))

const btcFrom = {
  chain: Chain.Bitcoin,
  ticker: 'BTC',
  decimals: 8,
  address: 'bc1qtest',
} as any

const ethTo = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  decimals: 18,
  address: '0x86d526d6624AbC0178cF7296cD538Ecc080A95F1',
} as any

const baseOkBody = {
  expected_amount_out: '1000',
  expiry: 1_700_000_000,
  fees: { affiliate: '0', asset: 'BTC.BTC', outbound: '0', total: '100', total_bps: 50 },
  memo: '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  warning: '',
}

describe('Station affiliate config', () => {
  it('stationNativeSwapAffiliateConfig uses stvs as affiliate address', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(baseOkBody)

    const { buildAffiliateParams } = await import('../native/api/affiliate')
    const result = buildAffiliateParams({
      swapChain: Chain.THORChain,
      affiliateBps: 50,
      config: stationNativeSwapAffiliateConfig,
    })

    expect(result.affiliate).toBe('stvs')
    expect(result.affiliate_bps).toBe('50')
  })

  it('stationOneInchAffiliateConfig uses Station EVM address as referrer', async () => {
    vi.mocked(queryUrl).mockReset()
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '999000000',
      tx: { from: '0xsender', to: '0xrouter', data: '0x', value: '0', gasPrice: '1000000000', gas: 200000 },
    })

    const { getOneInchSwapQuote } = await import('../general/oneInch/api/getOneInchSwapQuote')
    await getOneInchSwapQuote({
      account: { chain: Chain.Ethereum, address: '0xsender' },
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      amount: 1_000_000n,
      affiliateBps: 50,
      oneInchConfig: stationOneInchAffiliateConfig,
    })

    const [url] = vi.mocked(queryUrl).mock.calls[0]
    expect(String(url)).toContain(`referrer=${stationOneInchAffiliateConfig.referrer}`)
    expect(String(url)).toContain('fee=0.5')
  })

  it('stationKyberSwapAffiliateConfig uses Station EVM address as feeReceiver', async () => {
    vi.mocked(queryUrl).mockReset()
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        code: 0,
        message: 'OK',
        data: {
          routeSummary: { amountOut: '10000000' },
          routerAddress: '0xrouter',
        },
        requestId: 'req1',
      })
      .mockResolvedValueOnce({
        code: 0,
        data: { amountOut: '10000000', data: '0xswap', gas: '210000', routerAddress: '0xrouter' },
      })

    const { getKyberSwapQuote } = await import('../general/kyber/api/quote')
    await getKyberSwapQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', id: '0xsrc', decimals: 18, ticker: 'SRC' },
      to: { chain: Chain.Ethereum, address: '0xsender', id: '0xdst', decimals: 6, ticker: 'DST' },
      amount: 1_000_000n,
      affiliateBps: 50,
      kyberConfig: stationKyberSwapAffiliateConfig,
    })

    const [routeUrl, routeOptions] = vi.mocked(queryUrl).mock.calls[0]
    expect(String(routeUrl)).toContain(`feeReceiver=${stationKyberSwapAffiliateConfig.referral}`)
    expect(routeOptions).toMatchObject({
      headers: { 'X-Client-Id': stationKyberSwapAffiliateConfig.source },
    })

    const [, buildOptions] = vi.mocked(queryUrl).mock.calls[1]
    expect(buildOptions?.body).toMatchObject({
      feeReceiver: stationKyberSwapAffiliateConfig.referral,
    })
  })
})
