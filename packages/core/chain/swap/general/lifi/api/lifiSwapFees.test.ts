import type { FeeCost } from '@lifi/sdk'
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getLifiEvmSwapFees, getLifiSolanaSwapFees } from './lifiSwapFees'

const solanaNative = {
  address: '11111111111111111111111111111111',
  chainId: 1151111081099710,
  symbol: 'SOL',
  decimals: 9,
  name: 'SOL',
  priceUSD: '119.97',
}

// `estimate.feeCosts` LI.FI returned for vultisig-sdk#2396's route — 0.01 SOL
// to USDC at 30 bps under the `vultisig-0` integrator. The swap itself paid
// 30000 lamports to the integrator and 25000 to LI.FI on-chain.
const solanaFixedFee = {
  name: 'LIFI Fixed Fee',
  description: 'Fixed LIFI fee, independent of any other fee',
  token: solanaNative,
  amount: '55000',
  amountUSD: '0.0066',
  percentage: '0.0055',
  included: true,
  feeSplit: {
    lifiFee: '25000',
    integratorFee: '30000',
    recipients: [
      { name: 'lifi', type: 'FIXED', fee: '25000' },
      { name: 'vultisig-0', type: 'FIXED', fee: '30000' },
    ],
  },
} satisfies FeeCost

const liquidityFee = {
  name: 'DFlow Liquidity Fee',
  description: 'The cost of fees and slippage from liquidity providers involved in the aggregated swap.',
  token: solanaNative,
  amount: '0',
  amountUSD: '0.0000',
  percentage: '0',
  included: true,
} satisfies FeeCost

const recordedSolanaFeeCosts: FeeCost[] = [solanaFixedFee, liquidityFee]

const routeTokens = ['SOL', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']

describe('getLifiSolanaSwapFees', () => {
  it("separates LI.FI's own cut from the integrator's", () => {
    expect(getLifiSolanaSwapFees({ feeCosts: recordedSolanaFeeCosts, fromChain: Chain.Solana, routeTokens })).toEqual({
      swapFee: { amount: 30_000n, decimals: 9, chain: Chain.Solana, id: undefined },
      protocolFee: { amount: 25_000n, decimals: 9, chain: Chain.Solana, id: undefined },
    })
  })

  it('reports no protocol fee when the integrator takes the whole fixed fee', () => {
    const feeCosts: FeeCost[] = [
      { ...solanaFixedFee, amount: '30000', feeSplit: { ...solanaFixedFee.feeSplit, lifiFee: '0' } },
      liquidityFee,
    ]

    expect(getLifiSolanaSwapFees({ feeCosts, fromChain: Chain.Solana, routeTokens })).toEqual({
      swapFee: { amount: 30_000n, decimals: 9, chain: Chain.Solana, id: undefined },
    })
  })

  it('keeps an undivided fixed fee whole as the swap fee', () => {
    const undivided = { ...solanaFixedFee, feeSplit: undefined }

    expect(
      getLifiSolanaSwapFees({ feeCosts: [liquidityFee, undivided], fromChain: Chain.Solana, routeTokens })
    ).toEqual({
      swapFee: { amount: 55_000n, decimals: 9, chain: Chain.Solana, id: undefined },
    })
  })
})

describe('getLifiEvmSwapFees', () => {
  const usdt = {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    chainId: 1,
    symbol: 'USDT',
    decimals: 6,
    name: 'Tether USD',
    priceUSD: '1',
  }

  const evmFixedFee = {
    name: 'LIFI Fixed Fee',
    description: 'Fixed LIFI fee, independent of any other fee',
    token: usdt,
    amount: '5000',
    amountUSD: '0.005',
    percentage: '0.005',
    included: true,
    feeSplit: { lifiFee: '2500', integratorFee: '2500' },
  } satisfies FeeCost

  it("separates LI.FI's own cut from the integrator's", () => {
    expect(getLifiEvmSwapFees({ feeCosts: [evmFixedFee], fromChain: Chain.Ethereum })).toEqual({
      affiliateFee: { amount: 2_500n, decimals: 6, chain: Chain.Ethereum, id: usdt.address },
      protocolFee: { amount: 2_500n, decimals: 6, chain: Chain.Ethereum, id: usdt.address },
    })
  })

  it("still reports LI.FI's cut when the integrator charges nothing", () => {
    const feeCosts = [{ ...evmFixedFee, amount: '2500', feeSplit: { lifiFee: '2500', integratorFee: '0' } }]

    expect(getLifiEvmSwapFees({ feeCosts, fromChain: Chain.Ethereum })).toEqual({
      protocolFee: { amount: 2_500n, decimals: 6, chain: Chain.Ethereum, id: usdt.address },
    })
  })

  it('attributes nothing when no fee entry carries a split', () => {
    const undivided = { ...evmFixedFee, feeSplit: undefined }

    expect(getLifiEvmSwapFees({ feeCosts: [undivided], fromChain: Chain.Ethereum })).toEqual({})
  })
})

describe('LI.FI quotes with fees beyond the fixed fee', () => {
  const baseUsdc = {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin',
    priceUSD: '1',
  }

  // `estimate.feeCosts` LI.FI returned for 50 USDC to WETH on Base at 40 bps
  // with one `distributionFees` recipient at 0.10%: the distribution arrives as
  // an entry of its own, with no integrator slice.
  const fixedFee = {
    name: 'LIFI Fixed Fee',
    description: 'Fixed LIFI fee, independent of any other fee',
    token: baseUsdc,
    amount: '325000',
    amountUSD: '0.3259',
    percentage: '0.0065',
    included: true,
    feeSplit: {
      lifiFee: '125000',
      integratorFee: '200000',
      recipients: [
        { name: 'lifi', type: 'FIXED', fee: '125000' },
        { name: 'vultisig-0', type: 'FIXED', fee: '200000' },
      ],
    },
  } satisfies FeeCost

  const distributionFee = {
    name: 'Distributions',
    description: 'Distribution fees',
    token: baseUsdc,
    amount: '50000',
    amountUSD: '0.0501',
    percentage: '0.0010',
    included: true,
    feeSplit: {
      integratorFee: '0',
      lifiFee: '0',
      recipients: [
        {
          name: '0x000000000000000000000000000000000000dEaD',
          fee: '50000',
          type: 'DISTRIBUTION',
          walletAddress: '0x000000000000000000000000000000000000dEaD',
        },
      ],
    },
  } satisfies FeeCost

  const usdc = { decimals: 6, chain: Chain.Base, id: baseUsdc.address }

  it.each([
    ['fixed fee first', [fixedFee, distributionFee]],
    ['distribution first', [distributionFee, fixedFee]],
  ])('counts a distribution fee as a protocol charge (%s)', (_, feeCosts) => {
    expect(getLifiEvmSwapFees({ feeCosts, fromChain: Chain.Base })).toEqual({
      affiliateFee: { ...usdc, amount: 200_000n },
      protocolFee: { ...usdc, amount: 175_000n },
    })
  })

  it("leaves a bridge's own cost out of the fees", () => {
    // The route's cost rather than a fee LI.FI collects for a recipient: it has
    // no split, like the LayerSwap fee on an Ethereum to Arbitrum route.
    const bridgeFee = {
      name: 'LayerSwap fee',
      description: 'LayerSwap fee',
      token: baseUsdc,
      amount: '9580',
      amountUSD: '0.0096',
      percentage: '0.0002',
      included: true,
    } satisfies FeeCost

    expect(getLifiEvmSwapFees({ feeCosts: [fixedFee, bridgeFee], fromChain: Chain.Base })).toEqual({
      affiliateFee: { ...usdc, amount: 200_000n },
      protocolFee: { ...usdc, amount: 125_000n },
    })
  })

  it('skips a split fee in another token, which cannot be added', () => {
    const foreignFee = {
      ...distributionFee,
      token: { ...baseUsdc, address: '0x4200000000000000000000000000000000000006' },
    }

    expect(getLifiEvmSwapFees({ feeCosts: [fixedFee, foreignFee], fromChain: Chain.Base })).toEqual({
      affiliateFee: { ...usdc, amount: 200_000n },
      protocolFee: { ...usdc, amount: 125_000n },
    })
  })
})
