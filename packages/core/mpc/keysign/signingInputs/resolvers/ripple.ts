import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignTwPublicKey } from '../../tw/getKeysignTwPublicKey'
import { getLegacyDestinationTag, resolveDestinationTag } from '../../utils/rippleDestinationTag'
import { SigningInputsResolver } from '../resolver'

export const getRippleSigningInputs: SigningInputsResolver<'ripple'> = ({ keysignPayload }) => {
  const rippleSpecific = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'rippleSpecific')
  const { gas, sequence, lastLedgerSequence } = rippleSpecific

  const coin = assertField(keysignPayload, 'coin')

  const account = coin.address

  // An issued-currency coin (non-native, with a `currency.issuer` contract
  // address) signals a TrustSet: open/modify the trust line whose limit is the
  // keysign amount. Native XRP falls through to the Payment path below.
  const getTrustSet = (): Pick<TW.Ripple.Proto.ISigningInput, 'opTrustSet'> | undefined => {
    if (coin.isNativeToken || !coin.contractAddress) {
      return undefined
    }

    const { currency, issuer } = parseRippleTokenId(coin.contractAddress)

    return {
      opTrustSet: TW.Ripple.Proto.OperationTrustSet.create({
        limitAmount: TW.Ripple.Proto.CurrencyAmount.create({
          currency: toXrplCurrencyCode(currency),
          issuer,
          value: formatIssuedCurrencyValue(BigInt(keysignPayload.toAmount), coin.decimals),
        }),
      }),
    }
  }

  const getPayment = (): Pick<TW.Ripple.Proto.ISigningInput, 'opPayment' | 'rawJson'> => {
    const memo = keysignPayload.memo || undefined
    const destinationTag = resolveDestinationTag({
      destinationTag: rippleSpecific.destinationTag,
      memo,
    })

    // Preserve Johnny's compatibility matrix: a canonical numeric memo is a
    // legacy tag carrier when no typed field exists; when a typed field exists,
    // only an equal memo is the echoed carrier. A different memo is independent
    // even when it is numeric.
    const inferredLegacyCarrier =
      memo !== undefined &&
      ((rippleSpecific.destinationTag === undefined && getLegacyDestinationTag(memo) !== undefined) ||
        memo === destinationTag?.toString())
    const distinctMemo = inferredLegacyCarrier ? undefined : memo

    if (distinctMemo) {
      const memoDataHex = Buffer.from(distinctMemo, 'utf8').toString('hex').toUpperCase()

      const txJson = {
        TransactionType: 'Payment',
        Account: account,
        Destination: keysignPayload.toAddress,
        Amount: keysignPayload.toAmount,
        Fee: gas.toString(),
        Sequence: Number(sequence),
        LastLedgerSequence: Number(lastLedgerSequence),
        ...(destinationTag === undefined ? {} : { DestinationTag: destinationTag }),
        Memos: [
          {
            Memo: {
              MemoData: memoDataHex,
            },
          },
        ],
      }

      return {
        rawJson: JSON.stringify(txJson),
      }
    }

    return {
      opPayment: TW.Ripple.Proto.OperationPayment.create({
        destination: keysignPayload.toAddress,
        amount: Long.fromString(keysignPayload.toAmount),
        ...(destinationTag === undefined ? {} : { destinationTag: Long.fromNumber(destinationTag) as any }),
      }),
    }
  }

  const input = TW.Ripple.Proto.SigningInput.create({
    account,
    fee: Long.fromString(gas.toString()),
    sequence: Number(sequence),
    lastLedgerSequence: Number(lastLedgerSequence),
    publicKey: getKeysignTwPublicKey(keysignPayload),
    ...(getTrustSet() ?? getPayment()),
  })

  return [input]
}
