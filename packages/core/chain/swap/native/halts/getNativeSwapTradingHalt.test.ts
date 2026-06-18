import { Chain } from '@vultisig/core-chain/Chain'
import { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { describe, expect, it } from 'vitest'

import { getNativeSwapTradingHalt } from './getNativeSwapTradingHalt'

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

const makeInbound = (
  chain: string,
  overrides: Partial<Pick<InboundInfo, 'halted' | 'chain_trading_paused' | 'global_trading_paused'>> = {}
): InboundInfo => ({
  address: 'addr',
  chain,
  chain_lp_actions_paused: false,
  chain_trading_paused: false,
  dust_threshold: '0',
  gas_rate: '0',
  gas_rate_units: '',
  global_trading_paused: false,
  halted: false,
  observed_fee_rate: '0',
  outbound_fee: '0',
  outbound_tx_size: '0',
  pub_key: '',
  router: '',
  ...overrides,
})

const deps = (inbound: InboundInfo[]) => ({
  fetchInboundAddresses: async () => inbound,
})

describe('getNativeSwapTradingHalt', () => {
  it('returns null for non-THORChain native swap families', async () => {
    const result = await getNativeSwapTradingHalt(
      { from: eth, to: btc, swapChain: Chain.MayaChain },
      deps([makeInbound('ETH', { halted: true }), makeInbound('BTC')])
    )

    expect(result).toBeNull()
  })

  it('returns null when source and destination chains are trading', async () => {
    const result = await getNativeSwapTradingHalt(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('ETH'), makeInbound('BTC')])
    )

    expect(result).toBeNull()
  })

  it('reports halted and paused source or destination chains', async () => {
    const result = await getNativeSwapTradingHalt(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('ETH', { chain_trading_paused: true }), makeInbound('BTC', { halted: true })])
    )

    expect(result?.haltedChains).toEqual(['ETH', 'BTC'])
    expect(result?.reasons).toEqual(['ETH chain trading paused', 'BTC chain is halted'])
  })

  it('reports global trading pause once', async () => {
    const result = await getNativeSwapTradingHalt(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      deps([makeInbound('ETH', { global_trading_paused: true }), makeInbound('BTC')])
    )

    expect(result?.haltedChains).toEqual(['GLOBAL'])
    expect(result?.reasons).toEqual(['global trading paused'])
  })

  it('fails open when inbound_addresses cannot be fetched', async () => {
    const result = await getNativeSwapTradingHalt(
      { from: eth, to: btc, swapChain: Chain.THORChain },
      {
        fetchInboundAddresses: async () => {
          throw new Error('network down')
        },
      }
    )

    expect(result).toBeNull()
  })
})
