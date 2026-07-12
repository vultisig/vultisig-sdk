import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { attempt } from '@vultisig/lib-utils/attempt'
import { assertField } from '@vultisig/lib-utils/record/assertField'
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

  // A dApp-supplied XRPL transaction arrives as JSON in `signData.signRipple`
  // and is signed verbatim, letting types the payload cannot express — offers,
  // escrows — round-trip. Every signer rebuilds this input from the same JSON,
  // so each party serializes identical bytes. Nothing is reconstructed from the
  // payload's toAddress / toAmount (which cannot describe an offer); this
  // resolver is instead the fail-closed chokepoint that binds the raw
  // transaction to the signing vault (see the `Account` check below).
  const getRawJson = (): Pick<TW.Ripple.Proto.ISigningInput, 'rawJson'> | undefined => {
    if (keysignPayload.signData.case !== 'signRipple') {
      return undefined
    }

    const { rawJson } = keysignPayload.signData.value
    // An empty rawJson on an explicit signRipple case is malformed. Fail loudly
    // rather than falling through to build a native Payment from the payload's
    // toAddress/toAmount — signing an unintended transaction is the worse
    // outcome — and never emit a SigningInput with no operation set.
    if (!rawJson) {
      throw new Error('signRipple keysign payload is missing rawJson')
    }

    const parsed = attempt(() => JSON.parse(rawJson) as unknown)
    if ('error' in parsed) {
      throw new Error('signRipple rawJson is not valid JSON')
    }

    // Fail closed: the signed transaction must spend from the vault whose key
    // is signing. On XRPL the `Account` field is the sender, so every signer
    // — including a Secure Vault co-signer that only sees this payload —
    // rejects a raw transaction whose `Account` is anything but `coin.address`.
    // Without this the review surface and the signed bytes could diverge: a
    // payload could present one account/destination in its metadata while
    // `rawJson` moves a different account's funds. This bounds every signable
    // Ripple transaction to this vault's own funds regardless of the caller.
    const rawAccount =
      typeof parsed.data === 'object' && parsed.data !== null && 'Account' in parsed.data
        ? parsed.data.Account
        : undefined
    if (rawAccount !== account) {
      throw new Error('signRipple rawJson Account does not match the signing account')
    }

    return { rawJson }
  }

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
    if (keysignPayload.memo) {
      const destinationTag = parseInt(keysignPayload.memo, 10)

      if (!isNaN(destinationTag) && destinationTag.toString() === keysignPayload.memo) {
        const payment = TW.Ripple.Proto.OperationPayment.create({
          destination: keysignPayload.toAddress,
          amount: Long.fromString(keysignPayload.toAmount),
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
          Amount: keysignPayload.toAmount,
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
        amount: Long.fromString(keysignPayload.toAmount),
      }),
    }
  }

  const input = TW.Ripple.Proto.SigningInput.create({
    account,
    fee: Long.fromString(gas.toString()),
    sequence: Number(sequence),
    lastLedgerSequence: Number(lastLedgerSequence),
    publicKey: getKeysignTwPublicKey(keysignPayload),
    ...(getRawJson() ?? getTrustSet() ?? getPayment()),
  })

  return [input]
}
