/**
 * Parameterized integration test: SwapAffiliateConfig type contract
 *
 * Verifies that arbitrary affiliate configs (not Station-specific) propagate
 * correctly to each aggregator (THORChain native, 1inch, KyberSwap). Replaces
 * the deleted station.test.ts which tested concrete Station config values.
 * Tests the TYPE contract so future SwapAffiliateConfig changes are caught.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import type { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote, type SwapAffiliateConfig } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn().mockResolvedValue(null),
}))

// Keep the proactive THORChain minimum hermetic — no live inbound_addresses /
// pool fetches in unit tests. `null` = "no proactive signal" (#604).
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

// Generic test affiliate configs — NOT Station-specific.
// The TYPE contract is what matters; concrete values are consumer concern.
const mockAffiliateConfig: SwapAffiliateConfig = {
  native: {
    affiliateFeeAddress: 'testname',
    referralDiscountAffiliateFeeRateBps: 35,
    referrerFeeRateBps: 10,
  },
  kyber: {
    source: 'test-source-id',
    referral: '0xTestFeeReceiver',
  },
  oneInch: {
    referrer: '0xTestFeeReceiver',
  },
}

// Minimal NativeSwapQuote shape that satisfies the type and lets findSwapQuote
// compute getComparableOutputAmount without crashing.
const minimalNativeQuote: NativeSwapQuote = {
  swapChain: Chain.THORChain,
  expected_amount_out: '100000000',
  expiry: 0,
  fees: { affiliate: '0', asset: 'ETH.ETH', outbound: '0', total: '0' },
  inbound_address: '0xinbound',
  memo: 'TEST:ETH.ETH',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  warning: '',
}

function makeGeneralQuote(dstAmount: string) {
  return {
    dstAmount,
    tx: {
      evm: { from: '0xsender', to: '0xrouter', data: '0x', value: '0' },
    },
    provider: 'kyber' as const,
    routerAddress: '0xrouter',
    encodedSwapData: '0x',
    tokenIn: '0xsrc',
    tokenOut: '0xdst',
    amountIn: '1000000000000000000',
  }
}

// Cross-chain pair that hits the THORChain/native path
const thorPair = {
  from: {
    chain: Chain.Bitcoin,
    address: 'bc1qsender',
    decimals: 8,
    ticker: 'BTC',
  },
  to: {
    chain: Chain.Ethereum,
    address: '0xrecipient',
    decimals: 18,
    ticker: 'ETH',
  },
} as const

// Same-chain EVM pair that hits Kyber/1inch paths
const evmPair = {
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
} as const

describe('SwapAffiliateConfig propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
  })

  it('passes native affiliate config to THORChain quote fetcher', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockResolvedValue(minimalNativeQuote)

    await findSwapQuote({
      ...thorPair,
      amount: 10000000n,
      affiliateConfig: mockAffiliateConfig,
    })

    expect(getNativeSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeAffiliateConfig: mockAffiliateConfig.native,
      })
    )
  })

  it('passes kyber affiliate config to KyberSwap quote fetcher', async () => {
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(makeGeneralQuote('5000000'))

    await findSwapQuote({
      ...evmPair,
      amount: 1000000000000000000n,
      affiliateConfig: mockAffiliateConfig,
    })

    expect(getKyberSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        kyberConfig: mockAffiliateConfig.kyber,
      })
    )
  })

  it('passes oneInch affiliate config to 1inch quote fetcher', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(makeGeneralQuote('5000000'))

    await findSwapQuote({
      ...evmPair,
      amount: 1000000000000000000n,
      affiliateConfig: mockAffiliateConfig,
    })

    expect(getOneInchSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        oneInchConfig: mockAffiliateConfig.oneInch,
      })
    )
  })

  it('passes undefined nativeAffiliateConfig when no affiliateConfig supplied', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockResolvedValue(minimalNativeQuote)

    await findSwapQuote({
      ...thorPair,
      amount: 10000000n,
      // no affiliateConfig — falls back to vultisig-0 defaults inside buildAffiliateParams
    })

    expect(getNativeSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeAffiliateConfig: undefined,
      })
    )
  })

  describe('THORName case-sensitivity guard', () => {
    it('throws when affiliateFeeAddress contains uppercase characters', async () => {
      const badConfig: SwapAffiliateConfig = {
        native: {
          ...mockAffiliateConfig.native!,
          affiliateFeeAddress: 'STVS',
        },
      }

      await expect(
        findSwapQuote({
          ...thorPair,
          amount: 10000000n,
          affiliateConfig: badConfig,
        })
      ).rejects.toThrow('THORName affiliateFeeAddress must be lowercase')
    })

    it('throws when affiliateFeeAddress is mixed case', async () => {
      const badConfig: SwapAffiliateConfig = {
        native: {
          ...mockAffiliateConfig.native!,
          affiliateFeeAddress: 'Stvs',
        },
      }

      await expect(
        findSwapQuote({
          ...thorPair,
          amount: 10000000n,
          affiliateConfig: badConfig,
        })
      ).rejects.toThrow('THORName affiliateFeeAddress must be lowercase')
    })

    it('does not throw when affiliateFeeAddress is already lowercase', async () => {
      vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
      vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
      vi.mocked(getNativeSwapQuote).mockResolvedValue(minimalNativeQuote)

      // mockAffiliateConfig.native.affiliateFeeAddress = 'testname' (all lowercase)
      await expect(
        findSwapQuote({
          ...thorPair,
          amount: 10000000n,
          affiliateConfig: mockAffiliateConfig,
        })
      ).resolves.toBeDefined()
    })
  })
})
