import { Chain } from '@vultisig/core-chain/Chain'
import { ThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import type { ThorchainSecuredAssetCatalog } from '@vultisig/core-chain/chains/cosmos/thor/securedAssets'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { describe, expect, it } from 'vitest'

import { getThorchainSecuredAssetMintQuote, isSameUnderlyingThorchainSecuredAsset } from './securedAssetMint'

const fromUsdc: AccountCoin = {
  chain: Chain.Ethereum,
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  ticker: 'USDC',
  logo: 'usdc',
  decimals: 6,
  address: '0xfrom',
}

const securedUsdc: AccountCoin = {
  chain: Chain.THORChain,
  id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ticker: 'USDC',
  logo: 'usdc',
  decimals: 8,
  address: 'thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
}

const fromEth: AccountCoin = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  logo: 'eth',
  decimals: 18,
  address: '0xfrom',
}

const securedEth: AccountCoin = {
  chain: Chain.THORChain,
  id: 'eth-eth',
  ticker: 'ETH',
  logo: 'eth',
  decimals: 8,
  address: securedUsdc.address,
}

const inbound: ThorchainInboundAddress = {
  address: '0xinbound',
  chain: 'ETH',
  chain_lp_actions_paused: false,
  chain_trading_paused: false,
  dust_threshold: '0',
  gas_rate: '1',
  gas_rate_units: 'gwei',
  global_trading_paused: false,
  halted: false,
  observed_fee_rate: '1',
  outbound_fee: '0',
  outbound_tx_size: '0',
  pub_key: 'thorpub1',
  router: '0xrouter',
}

const catalog: ThorchainSecuredAssetCatalog = {
  source: 'thorchain' as const,
  assets: [
    {
      ...securedUsdc,
      id: securedUsdc.id!,
      logo: 'usdc',
      l1Asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      isSecured: true as const,
      supply: '1',
      depth: '1',
    },
  ],
}

const ethCatalog: ThorchainSecuredAssetCatalog = {
  source: 'thorchain',
  assets: [
    {
      ...securedEth,
      id: securedEth.id!,
      logo: 'eth',
      l1Asset: 'ETH.ETH',
      isSecured: true,
      supply: '1',
      depth: '1',
    },
  ],
}

const liveStatus = {
  fetchSecuredAssetCatalog: async () => catalog,
  fetchMimir: async () => ({}),
}

describe('THORChain SECURE+ mint routing', () => {
  it('recognizes matching native and token underlyings case-insensitively', () => {
    expect(
      isSameUnderlyingThorchainSecuredAsset({
        from: fromUsdc,
        to: securedUsdc,
      })
    ).toBe(true)
    expect(
      isSameUnderlyingThorchainSecuredAsset({
        from: {
          ...fromUsdc,
          chain: Chain.Bitcoin,
          id: undefined,
          ticker: 'BTC',
          decimals: 8,
        },
        to: { ...securedUsdc, id: 'btc-btc', ticker: 'BTC' },
      })
    ).toBe(true)
    expect(
      isSameUnderlyingThorchainSecuredAsset({
        from: {
          ...fromUsdc,
          chain: Chain.Ethereum,
          id: undefined,
          ticker: 'ETH',
          decimals: 18,
        },
        to: securedUsdc,
      })
    ).toBe(false)
  })

  it('builds a fee-free 1:1 SECURE+ quote through the source inbound router', async () => {
    const quote = await getThorchainSecuredAssetMintQuote({
      from: fromUsdc,
      to: securedUsdc,
      amount: 1_500_000n,
      destination: securedUsdc.address,
      fetchInboundAddresses: async () => [inbound],
      ...liveStatus,
      now: () => 1_700_000_000_000,
    })

    expect(quote).toMatchObject({
      swapChain: Chain.THORChain,
      expected_amount_out: '150000000',
      expiry: 1_700_000_900,
      inbound_address: '0xinbound',
      router: '0xrouter',
      memo: 'SECURE+:thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
      recommended_min_amount_in: '0',
      dust_threshold: '0',
      liquidity_tolerance_bps: 0,
      fees: {
        asset: 'ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        total: '0',
        total_bps: 0,
      },
    })
  })

  it('uses the live share ratio and does not confuse an LP pause with a secured-deposit halt', async () => {
    const quote = await getThorchainSecuredAssetMintQuote({
      from: fromUsdc,
      to: securedUsdc,
      amount: 1_000_000n,
      destination: securedUsdc.address,
      fetchInboundAddresses: async () => [{ ...inbound, chain_lp_actions_paused: true }],
      fetchSecuredAssetCatalog: async () => ({
        ...catalog,
        assets: [{ ...catalog.assets[0], supply: '3', depth: '2' }],
      }),
      fetchMimir: async () => ({}),
    })

    expect(quote.expected_amount_out).toBe('150000000')
  })

  it('fails closed when SECURE+ deposits are paused', async () => {
    await expect(
      getThorchainSecuredAssetMintQuote({
        from: fromUsdc,
        to: securedUsdc,
        amount: 1_000_000n,
        destination: securedUsdc.address,
        fetchInboundAddresses: async () => [inbound],
        fetchSecuredAssetCatalog: async () => catalog,
        fetchMimir: async () => ({ 'HALTSECUREDDEPOSIT-ETH': 1 }),
      })
    ).rejects.toThrow(/paused/)
  })

  it('does not apply the source gas-asset dust threshold to routed ERC-20 deposits', async () => {
    const quote = await getThorchainSecuredAssetMintQuote({
      from: fromUsdc,
      to: securedUsdc,
      amount: 999n,
      destination: securedUsdc.address,
      fetchInboundAddresses: async () => [{ ...inbound, dust_threshold: '1000' }],
      ...liveStatus,
    })

    expect(quote).toMatchObject({
      expected_amount_out: '99900',
      recommended_min_amount_in: '0',
      dust_threshold: '1000',
    })
  })

  it('compares native deposits to the raw 1e8 dust threshold after precision normalization', async () => {
    const quoteInput = {
      from: fromEth,
      to: securedEth,
      destination: securedEth.address,
      fetchInboundAddresses: async () => [{ ...inbound, dust_threshold: '100000' }],
      fetchSecuredAssetCatalog: async () => ethCatalog,
      fetchMimir: async () => ({}),
    }

    await expect(
      getThorchainSecuredAssetMintQuote({
        ...quoteInput,
        amount: 999_999_999_999_999n,
      })
    ).rejects.toThrow(/dust threshold/)

    await expect(
      getThorchainSecuredAssetMintQuote({
        ...quoteInput,
        amount: 1_000_000_000_000_000n,
      })
    ).resolves.toMatchObject({
      expected_amount_out: '100000',
      recommended_min_amount_in: '100000',
      dust_threshold: '100000',
    })
  })

  it('rejects negative dust metadata for token deposits', async () => {
    await expect(
      getThorchainSecuredAssetMintQuote({
        from: fromUsdc,
        to: securedUsdc,
        amount: 1_000_000n,
        destination: securedUsdc.address,
        fetchInboundAddresses: async () => [{ ...inbound, dust_threshold: '-1' }],
        ...liveStatus,
      })
    ).rejects.toThrow(/dust threshold/)
  })

  it('rejects malformed or non-THOR destinations before returning a quote', async () => {
    await expect(
      getThorchainSecuredAssetMintQuote({
        from: fromUsdc,
        to: securedUsdc,
        amount: 1_000_000n,
        destination: 'thor1destination',
        fetchInboundAddresses: async () => [inbound],
        ...liveStatus,
      })
    ).rejects.toThrow(/valid THORChain account destination/)
  })
})
