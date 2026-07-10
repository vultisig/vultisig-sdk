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
import { SigningInputsResolver } from '../resolver'

const maxRippleDestinationTag = 0xffffffff

const validateDestinationTag = (destinationTag: number): number => {
  if (!Number.isInteger(destinationTag) || destinationTag < 1 || destinationTag > maxRippleDestinationTag) {
    throw new Error(`Invalid XRP destination tag: expected an integer between 1 and ${maxRippleDestinationTag}`)
  }

  return destinationTag
}

const getLegacyDestinationTag = (memo: string): number | undefined => {
  // A legacy tag carrier must be its canonical decimal form. Preserve zero:
  // older SDK/Android builds signed a canonical "0" memo as DestinationTag 0.
  if (!/^(0|[1-9]\d*)$/.test(memo)) return undefined

  const destinationTag = Number(memo)
  return destinationTag <= maxRippleDestinationTag ? destinationTag : undefined
}

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
    const legacyDestinationTag = memo ? getLegacyDestinationTag(memo) : undefined
    const destinationTag =
      rippleSpecific.destinationTag === undefined
        ? legacyDestinationTag
        : validateDestinationTag(rippleSpecific.destinationTag)

    // During the transition, clients may put the tag in both fields. That
    // echoed value is not an independent memo, so keep the typed tag-only
    // form byte-compatible with legacy signers.
    const distinctMemo = memo && memo !== destinationTag?.toString() ? memo : undefined

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
