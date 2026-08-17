import { Chain } from '@vultisig/core-chain/Chain'
import type { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'

/**
 * Shared fixtures for the findSwapQuote test suites. Only data builders live
 * here — `vi.mock` registrations cannot be shared because vitest hoists them
 * per test file, so each suite declares its own mocks and builds scenarios
 * from these fixtures.
 */
export const evmSameChainCoins = {
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

/** An aggregator quote with the minimal fields ranking and binding need. */
export function minimalGeneralQuote(
  dstAmount: string,
  provider: 'kyber' | '1inch' | 'swapkit' | 'li.fi' | 'jupiter',
  tx: GeneralSwapQuote['tx'] = {
    evm: {
      from: '0xsender',
      to: '0xrouter',
      data: '0x',
      value: '0',
    },
  }
): GeneralSwapQuote {
  const base = {
    dstAmount,
    tx,
  }
  return { ...base, provider }
}

/** A CowSwap RFQ order quote with the minimal fields ranking and binding need. */
export function minimalCowSwapQuote(dstAmount: string, sellAmount = '1000000000000000000'): GeneralSwapQuote {
  return {
    dstAmount,
    provider: 'cowswap',
    tx: {
      cowswap_order: {
        sellToken: '0xsrc',
        buyToken: '0xdst',
        receiver: '0xsender',
        sellAmount,
        buyAmount: dstAmount,
        validTo: 1,
        appData: '0x',
        appDataHash: '0x',
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        chainId: 1,
        apiBase: 'https://api.cow.fi/mainnet',
      },
    },
  }
}

/** A native THORChain/MayaChain quote with the minimal fields ranking and binding need. */
export function minimalNativeQuote(swapChain: Chain, expected_amount_out: string): NativeSwapQuote {
  return {
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
  }
}
