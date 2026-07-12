import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { toBoundedBigInt } from '@vultisig/lib-utils/bigint/toBoundedBigInt'
import { toBoundedLong } from '@vultisig/lib-utils/bigint/toBoundedLong'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignTwPublicKey } from '../../tw/getKeysignTwPublicKey'
import { SigningInputsResolver } from '../resolver'

export const getRippleSigningInputs: SigningInputsResolver<'ripple'> = ({ keysignPayload }) => {
  const { gas, sequence, lastLedgerSequence } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'rippleSpecific'
  )

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
          value: formatIssuedCurrencyValue(
            toBoundedBigInt(keysignPayload.toAmount, { bits: 128, signed: false }),
            coin.decimals
          ),
        }),
      }),
    }
  }

  const getPayment = (): Pick<TW.Ripple.Proto.ISigningInput, 'opPayment' | 'rawJson'> => {
    if (keysignPayload.memo) {
      const destinationTag = parseInt(keysignPayload.memo, 10)

      if (!isNaN(destinationTag) && destinationTag.toString() === keysignPayload.memo) {
        const payment = TW.Ripple.Proto.OperationPayment.create({
          destination: keysignPayload.toAddress,
          amount: toBoundedLong(keysignPayload.toAmount, { unsigned: false }),
          destinationTag: Long.fromNumber(destinationTag) as any,
        })

        return {
          opPayment: payment,
        }
      } else {
        const memoDataHex = Buffer.from(keysignPayload.memo, 'utf8').toString('hex').toUpperCase()

        const txJson = {
          TransactionType: 'Payment',
          Account: account,
          Destination: keysignPayload.toAddress,
          // Unlike the two Payment PROTO paths (int64 field, so signedness must
          // match), this is a plain JSON string: XRP drops are non-negative, so
          // reject a negative amount here instead of building JSON that XRPL
          // would bounce after the MPC ceremony already ran.
          Amount: toBoundedLong(keysignPayload.toAmount, { unsigned: true }).toString(),
          Fee: gas.toString(),
          Sequence: Number(sequence),
          LastLedgerSequence: Number(lastLedgerSequence),
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
    }

    return {
      opPayment: TW.Ripple.Proto.OperationPayment.create({
        destination: keysignPayload.toAddress,
        amount: toBoundedLong(keysignPayload.toAmount, { unsigned: false }),
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
