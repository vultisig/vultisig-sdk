import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { bigishToString, emptyToUndefined } from '../utils'
import { mapNestedCoin } from './mapNestedCoin'

export const mapSwapPayload = (spRaw: any): KeysignPayload['swapPayload'] | undefined => {
  if (!spRaw) return

  if (spRaw.OneinchSwapPayload || spRaw.oneinchSwapPayload || spRaw.OneInchSwapPayload) {
    const o = spRaw.OneinchSwapPayload ?? spRaw.oneinchSwapPayload ?? spRaw.OneInchSwapPayload

    const res: KeysignPayload['swapPayload'] = {
      case: 'oneinchSwapPayload',
      value: {
        $typeName: 'vultisig.keysign.v1.OneInchSwapPayload',
        fromCoin: mapNestedCoin(o.from_coin ?? o.fromCoin),
        toCoin: mapNestedCoin(o.to_coin ?? o.toCoin),
        fromAmount: String(o.from_amount ?? o.fromAmount),
        toAmountDecimal: o.to_amount_decimal ?? o.toAmountDecimal,
        quote: o.quote
          ? {
              $typeName: '' as any,
              dstAmount: String(o.quote.dst_amount ?? o.quote.dstAmount),
              tx: o.quote.tx
                ? {
                    // `swap_fee` lives on `tx` per the proto, but historical iOS
                    // fixtures have surfaced it one level up on `quote`; accept
                    // both paths so existing roundtrip fixtures keep working.
                    swapFee: String(o.quote.tx.swap_fee ?? o.quote.tx.swapFee ?? o.quote.swap_fee ?? 0),
                    // Coin context for `swap_fee` (proto fields 8/9/10, optional).
                    // Forward whichever casing iOS emits so the cosigner can
                    // render the fee row with correct decimals/asset attribution
                    // — without this, the new fields would be silently dropped
                    // on iOS → TS fixture roundtrips and KyberSwap-style payloads
                    // would misread a destination-token fee as the source fee
                    // coin. (NeOMakinG #540 preferably-blocking #1.)
                    swapFeeChain: o.quote.tx.swap_fee_chain ?? o.quote.tx.swapFeeChain,
                    swapFeeTokenId: o.quote.tx.swap_fee_token_id ?? o.quote.tx.swapFeeTokenId,
                    swapFeeDecimals:
                      o.quote.tx.swap_fee_decimals != null
                        ? Number(o.quote.tx.swap_fee_decimals)
                        : o.quote.tx.swapFeeDecimals != null
                          ? Number(o.quote.tx.swapFeeDecimals)
                          : undefined,
                    $typeName: '' as any,
                    data: o.quote.tx.data,
                    from: o.quote.tx.from,
                    gas: o.quote.tx.gas !== undefined && o.quote.tx.gas !== null ? BigInt(o.quote.tx.gas) : 0n,
                    gasPrice: bigishToString(o.quote.tx.gas_price ?? o.quote.tx.gasPrice) ?? '',
                    to: o.quote.tx.to,
                    value: bigishToString(o.quote.tx.value) ?? '',
                  }
                : undefined,
            }
          : undefined,
        provider: '1inch',
      },
    }

    return res
  }

  if (spRaw.ThorchainSwapPayload || spRaw.thorchainSwapPayload) {
    const t = spRaw.ThorchainSwapPayload ?? spRaw.thorchainSwapPayload

    const fromAddr = t.from_address ?? t.fromAddress ?? ''
    const vaultAddressIn = t.vault_address ?? t.vaultAddress ?? ''
    const feeIn = t.fee // iOS keeps "" in fixtures

    const res: KeysignPayload['swapPayload'] = {
      case: 'thorchainSwapPayload',
      value: {
        $typeName: 'vultisig.keysign.v1.THORChainSwapPayload',
        fromAddress: fromAddr,
        fromCoin: mapNestedCoin(t.from_coin ?? t.fromCoin),
        toCoin: mapNestedCoin(t.to_coin ?? t.toCoin),
        vaultAddress: vaultAddressIn,
        routerAddress: emptyToUndefined(t.router_address ?? t.routerAddress),
        fromAmount: String(t.from_amount ?? t.fromAmount),
        toAmountDecimal: t.to_amount_decimal ?? t.toAmountDecimal,
        toAmountLimit: String(t.to_amount_limit ?? t.toAmountLimit ?? ''),
        streamingInterval: String(t.streaming_interval ?? t.streamingInterval ?? ''),
        streamingQuantity: String(t.streaming_quantity ?? t.streamingQuantity ?? ''),
        isAffiliate: Boolean(t.is_affiliate ?? t.isAffiliate),
        fee: feeIn === undefined ? '' : String(feeIn),
        expirationTime: BigInt(t.expiration_time ?? t.expirationTime ?? 0),
      },
    }

    return res
  }
}
