import { Chain } from '@vultisig/core-chain/Chain'
import { ThorchainPoolSummary } from '@vultisig/core-chain/chains/cosmos/thor/lp/pools'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { describe, expect, it } from 'vitest'

import { getThorchainInboundAddress } from '../../../chains/cosmos/thor/getThorchainInboundAddress'
import { getNativeSwapMinAmountIn } from './getNativeSwapMinAmountIn'

type InboundInfo = Awaited<ReturnType<typeof getThorchainInboundAddress>>[number]

const eth: AccountCoin = {
  chain: Chain.Ethereum,
  address: '0xsender',
  decimals: 18,
  ticker: 'ETH',
}

const btc: AccountCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1qdest',
  decimals: 8,
  ticker: 'BTC',
}

const usdc: AccountCoin = {
  chain: Chain.Ethereum,
  address: '0xsender',
  decimals: 6,
  ticker: 'USDC',
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
}

const makeInbound = (chain: string, outbound_fee: string, dust_threshold = '0'): InboundInfo => ({
  address: 'addr',
  chain,
  chain_lp_actions_paused: false,
  chain_trading_paused: false,
  dust_threshold,
  gas_rate: '0',
  gas_rate_units: '',
  global_trading_paused: false,
  halted: false,
  observed_fee_rate: '0',
  outbound_fee,
  outbound_tx_size: '0',
  pub_key: '',
  router: '',
})

const makePool = (asset: string, assetDepth: string, runeDepth: string): ThorchainPoolSummary => ({
  asset,
  status: 'available',
  assetDepth,
  runeDepth,
  liquidityUnits: '0',
  volume24h: '0',
  annualPercentageRate: '0',
})

// BTC priced at 6000 RUNE, ETH at 300 RUNE (all depths in 1e8 thor units).
const pools = [
  makePool('BTC.BTC', '10000000000', '60000000000000'),
  makePool('ETH.ETH', '100000000000', '30000000000000'),
]

const deps = (inbound: InboundInfo[], poolList = pools) => ({
  fetchInboundAddresses: async () => inbound,
  fetchPools: async () => poolList,
})

describe('getNativeSwapMinAmountIn', () => {
  it('computes the minimum input from the destination outbound fee and spot pool prices', async () => {
    // outbound_fee 30000 (0.0003 BTC) x BUFFER(2) x priceBTC(6000) = 360_000_000 RUNE-units;
    // / priceETH(300) = 1_200_000 thor units = 0.012 ETH.
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('BTC', '30000')])
    )

    expect(result).not.toBeNull()
    expect(result?.swapChain).toBe(Chain.THORChain)
    expect(result?.minAmountInHuman).toBe('0.012')
    expect(result?.minAmountInBaseUnits).toBe(12_000_000_000_000_000n)
    expect(result?.outboundFeeBaseUnit).toBe('30000')
    expect(result?.binding).toBe('outbound')
  })

  it('takes the source dust threshold when it exceeds the outbound minimum (gas-asset input)', async () => {
    // outbound min is 0.012 ETH (as above); the ETH source dust_threshold of
    // 5_000_000 thor units (0.05 ETH) is larger, so the dust floor binds.
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('BTC', '30000'), makeInbound('ETH', '120000', '5000000')])
    )

    expect(result?.minAmountInHuman).toBe('0.05')
    expect(result?.dustThresholdBaseUnit).toBe('5000000')
    expect(result?.binding).toBe('dust')
  })

  it('keeps the outbound minimum when the dust threshold is smaller', async () => {
    // ETH dust_threshold 100_000 thor units (0.001 ETH) < outbound min (0.012 ETH).
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('BTC', '30000'), makeInbound('ETH', '120000', '100000')])
    )

    expect(result?.minAmountInHuman).toBe('0.012')
    expect(result?.binding).toBe('outbound')
  })

  it('converts a token-input dust threshold via the source gas-asset pool', async () => {
    // from = USDC (gas asset is ETH). dust_threshold is denominated in ETH:
    // 5_000_000 (0.05 ETH) x priceETH(300) / priceUSDC(1) = 1_500_000_000 thor
    // units = 15 USDC, which exceeds the outbound min (3.6 USDC).
    const result = await getNativeSwapMinAmountIn(
      { from: usdc, to: btc, swapChain: Chain.THORChain },
      deps(
        [makeInbound('BTC', '30000'), makeInbound('ETH', '120000', '5000000')],
        [...pools, makePool('ETH.USDC-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '100000000000', '100000000000')]
      )
    )

    expect(result?.minAmountInHuman).toBe('15')
    expect(result?.minAmountInBaseUnits).toBe(15_000_000n)
    expect(result?.binding).toBe('dust')
  })

  it('returns null for MayaChain (out of scope for v1)', async () => {
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.MayaChain },
      deps([makeInbound('BTC', '30000')])
    )
    expect(result).toBeNull()
  })

  it('returns null when the destination chain is absent from inbound_addresses', async () => {
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('ETH', '120000')])
    )
    expect(result).toBeNull()
  })

  it('returns null when a required pool is missing', async () => {
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      {
        fetchInboundAddresses: async () => [makeInbound('BTC', '30000')],
        fetchPools: async () => [makePool('BTC.BTC', '10000000000', '60000000000000')], // no ETH.ETH pool
      }
    )
    expect(result).toBeNull()
  })

  it('returns null on a non-positive outbound fee', async () => {
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('BTC', '0')])
    )
    expect(result).toBeNull()
  })

  it('never throws — a fetch failure resolves to null', async () => {
    const result = await getNativeSwapMinAmountIn(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      {
        fetchInboundAddresses: async () => {
          throw new Error('network down')
        },
        fetchPools: async () => pools,
      }
    )
    expect(result).toBeNull()
  })
})
