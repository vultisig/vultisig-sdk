import { Chain } from '@vultisig/core-chain/Chain'
import { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { getThorchainMimir } from '@vultisig/core-chain/chains/cosmos/thor/lp/validation'
import { getThorchainSecuredAssetCatalog } from '@vultisig/core-chain/chains/cosmos/thor/securedAssets'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress', () => ({
  getThorchainInboundAddress: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/thor/lp/validation', () => ({
  getThorchainMimir: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/thor/securedAssets', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/cosmos/thor/securedAssets')>()),
  getThorchainSecuredAssetCatalog: vi.fn(),
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

vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

const from = {
  chain: Chain.Ethereum,
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  ticker: 'USDC',
  decimals: 6,
  address: '0xfrom',
}

const to = {
  chain: Chain.THORChain,
  id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ticker: 'USDC',
  decimals: 8,
  address: 'thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
}

const poolQuote: NativeSwapQuote = {
  swapChain: Chain.THORChain,
  expected_amount_out: '99000000',
  expiry: 0,
  fees: { affiliate: '0', asset: 'ETH-USDC', outbound: '0', total: '1000000' },
  inbound_address: '0xinbound',
  memo: '=:ETH-USDC:thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  warning: '',
}

describe('findSwapQuote same-underlying secured destinations', () => {
  beforeEach(() => {
    vi.mocked(getThorchainInboundAddress).mockResolvedValue([
      {
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
      },
    ])
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('pool quote must not be used'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('excluded'))
    vi.mocked(getThorchainMimir).mockResolvedValue({})
    vi.mocked(getThorchainSecuredAssetCatalog).mockResolvedValue({
      source: 'thorchain',
      assets: [
        {
          ...to,
          logo: 'usdc',
          l1Asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          isSecured: true,
          supply: '1',
          depth: '1',
        },
      ],
    })
  })

  it('selects the direct SECURE+ mint instead of requesting a 1:1 pool swap', async () => {
    const quote = await findSwapQuote({
      from,
      to,
      amount: 1_000_000n,
      excludeProviders: ['MayaChain', 'SwapKit'],
    })

    expect(quote.discounts).toEqual([])
    expect(quote.quote).toMatchObject({
      native: {
        expected_amount_out: '100000000',
        memo: 'SECURE+:thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
        fees: { total: '0' },
      },
    })
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('preserves the existing pool quote when live secured status is unavailable', async () => {
    vi.mocked(getThorchainSecuredAssetCatalog).mockResolvedValue({ source: 'fallback', assets: [] })
    vi.mocked(getNativeSwapQuote).mockResolvedValue(poolQuote)

    const quote = await findSwapQuote({
      from,
      to,
      amount: 1_000_000n,
      excludeProviders: ['MayaChain', 'SwapKit'],
    })

    expect(quote.quote).toEqual({ native: poolQuote })
    expect(getNativeSwapQuote).toHaveBeenCalledOnce()
  })
})
