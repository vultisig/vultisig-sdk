import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { GeneralSwapTx } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { SwapQuote, SwapQuoteResult } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { EvmChain } from '../../Chain'

type GetSwapDestinationAddressInput = {
  quote: SwapQuote
  fromCoin: AccountCoin
}

export const getSwapDestinationAddress = ({ quote, fromCoin }: GetSwapDestinationAddressInput): string =>
  matchRecordUnion<SwapQuoteResult, string>(quote.quote, {
    general: quote =>
      matchRecordUnion<GeneralSwapTx, string>(quote.tx, {
        evm: ({ to }) => to,
        solana: () => '',
        transfer: ({ to }) => to,
        // CowSwap orders are settled by the solver network — no on-chain
        // destination address is needed at keysign time.
        cowswap_order: () => '',
      }),
    native: quote => {
      const isErc20 = isOneOf(fromCoin.chain, Object.values(EvmChain)) && !isFeeCoin(fromCoin)

      return (isErc20 ? quote.router : quote.inbound_address) || fromCoin.address
    },
  })
