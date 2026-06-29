import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import type { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getJupiterSwapQuote } from '@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { getNativeSwapTradingHalt } from '@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt'
import { getNativeSwapMinAmountIn } from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({
  getCowSwapQuote: vi.fn(),
}))
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
vi.mock('@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote', () => ({
  getJupiterSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn(),
}))

const solUsdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const solNative = {
  chain: Chain.Solana,
  address: 'SoLAddrSender1111111111111111111111111111111',
  decimals: 9,
  ticker: 'SOL',
} as const

const solUsdc = {
  chain: Chain.Solana,
  address: 'SoLAddrSender1111111111111111111111111111111',
  id: solUsdcMint,
  decimals: 6,
  ticker: 'USDC',
} as const

const ethNative = {
  chain: Chain.Ethereum,
  address: '0xsender',
  decimals: 18,
  ticker: 'ETH',
} as const

const jupiterSolanaQuote = (dstAmount: string): GeneralSwapQuote => ({
  dstAmount,
  provider: 'jupiter',
  tx: {
    solana: {
      data: 'base64-tx',
      networkFee: 5000n,
      swapFee: { amount: 1000n, decimals: 6, chain: Chain.Solana, id: solUsdcMint },
    },
  },
})

const swapKitSolanaQuote = (dstAmount: string): GeneralSwapQuote => ({
  dstAmount,
  provider: 'swapkit',
  routeProvider: 'JUPITER',
  tx: {
    solana: {
      data: 'base64-tx',
      networkFee: 5000n,
      swapFee: { amount: 0n, decimals: 6, chain: Chain.Solana, id: solUsdcMint },
    },
  },
})

const minimalNativeQuote = (swapChain: Chain, expected_amount_out: string): NativeSwapQuote =>
  ({
    swapChain: swapChain as NativeSwapQuote['swapChain'],
    expected_amount_out,
    expiry: 0,
    fees: { affiliate: '0', asset: '0', outbound: '0', total: '0' },
    memo: '',
    notes: '',
    outbound_delay_blocks: 0,
    outbound_delay_seconds: 0,
    recommended_min_amount_in: '0',
    warning: '',
  }) as NativeSwapQuote

describe('findSwapQuote — Jupiter routing', () => {
  beforeEach(() => {
    vi.mocked(getCowSwapQuote).mockReset().mockRejectedValue(new Error('skip cowswap'))
    vi.mocked(getKyberSwapQuote).mockReset().mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockReset().mockRejectedValue(new Error('skip 1inch'))
    vi.mocked(getLifiSwapQuote).mockReset().mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockReset().mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getJupiterSwapQuote).mockReset().mockRejectedValue(new Error('skip jupiter'))
    vi.mocked(getNativeSwapQuote).mockReset().mockRejectedValue(new Error('skip native'))
    vi.mocked(getNativeSwapTradingHalt).mockReset().mockResolvedValue(null)
    vi.mocked(getNativeSwapMinAmountIn).mockReset().mockResolvedValue(null)
  })

  it('routes a same-chain Solana pair (SOL→SPL) through Jupiter', async () => {
    vi.mocked(getJupiterSwapQuote).mockResolvedValue(jupiterSolanaQuote('1000000'))

    const result = await findSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n })

    expect(getJupiterSwapQuote).toHaveBeenCalledTimes(1)
    expect('general' in result.quote && result.quote.general.provider).toBe('jupiter')
  })

  it('passes the VULT-scaled affiliate bps to Jupiter (0-discount → 50 bps)', async () => {
    vi.mocked(getJupiterSwapQuote).mockResolvedValue(jupiterSolanaQuote('1000000'))

    await findSwapQuote({ from: solUsdc, to: solNative, amount: 1_000_000n })

    expect(getJupiterSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ affiliateBps: 50 }))
  })

  it('floors the affiliate bps at 0 for an Ultimate-tier VULT holder', async () => {
    vi.mocked(getJupiterSwapQuote).mockResolvedValue(jupiterSolanaQuote('1000000'))

    await findSwapQuote({ from: solUsdc, to: solNative, amount: 1_000_000n, vultDiscountTier: 'ultimate' })

    expect(getJupiterSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ affiliateBps: 0 }))
  })

  it('prefers Jupiter over SwapKit on a near-tie for same-chain Solana', async () => {
    vi.mocked(getJupiterSwapQuote).mockResolvedValue(jupiterSolanaQuote('1000000'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(swapKitSolanaQuote('1000000'))

    const result = await findSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n })

    expect('general' in result.quote && result.quote.general.provider).toBe('jupiter')
  })

  it('never offers Jupiter for a cross-chain (out-of-Solana) pair', async () => {
    vi.mocked(getNativeSwapQuote).mockResolvedValue(minimalNativeQuote(Chain.THORChain, '100000000'))

    const result = await findSwapQuote({ from: solNative, to: ethNative, amount: 1_000_000_000n })

    expect(getJupiterSwapQuote).not.toHaveBeenCalled()
    expect('native' in result.quote).toBe(true)
  })
})
