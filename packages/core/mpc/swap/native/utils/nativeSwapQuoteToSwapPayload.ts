import { create } from '@bufbuild/protobuf'
import { fromChainAmount } from '@vultisig/core-chain/amount/fromChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import {
  nativeSwapPayloadCase,
  nativeSwapStreamingInterval,
} from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'
import { parseThorchainSwapMemoStreaming } from '@vultisig/core-chain/swap/native/utils/parseThorchainSwapMemoStreaming'
import { convertDuration } from '@vultisig/lib-utils/time/convertDuration'
import { addMinutes } from 'date-fns'

import { CommKeysignSwapPayload } from '../../../keysign/swap/KeysignSwapPayload'
import { toCommCoin } from '../../../types/utils/commCoin'
import { THORChainSwapPayloadSchema } from '../../../types/vultisig/keysign/v1/thorchain_swap_payload_pb'

type Input = {
  quote: NativeSwapQuote
  fromCoin: AccountCoin & { hexPublicKey: string }
  toCoin: AccountCoin & { hexPublicKey: string }
  amount: bigint
}

export const nativeSwapQuoteToSwapPayload = ({
  quote,
  fromCoin,
  amount,
  toCoin,
}: Input): CommKeysignSwapPayload => {
  const isAffiliate = !!quote.fees.affiliate && Number(quote.fees.affiliate) > 0

  const { streamingInterval, streamingQuantity } =
    quote.swapChain === Chain.THORChain
      ? parseThorchainSwapMemoStreaming(quote.memo)
      : {
          streamingInterval: String(
            nativeSwapStreamingInterval[quote.swapChain]
          ),
          streamingQuantity: '0',
        }

  const toDecimals = getNativeSwapDecimals(toCoin)

  return {
    case: nativeSwapPayloadCase[quote.swapChain],
    value: create(THORChainSwapPayloadSchema, {
      fromAddress: fromCoin.address,
      fromCoin: toCommCoin(fromCoin),
      toCoin: toCommCoin(toCoin),
      vaultAddress: quote.inbound_address ?? fromCoin.address,
      routerAddress: quote.router,
      fromAmount: amount.toString(),
      toAmountDecimal: fromChainAmount(
        quote.expected_amount_out,
        toDecimals
      ).toFixed(toDecimals),
      expirationTime: BigInt(
        Math.round(
          convertDuration(addMinutes(Date.now(), 15).getTime(), 'ms', 's')
        )
      ),
      streamingInterval,
      streamingQuantity,
      toAmountLimit: '0',
      isAffiliate,
    }),
  }
}
