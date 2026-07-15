import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  parseIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { attempt } from '@vultisig/lib-utils/attempt'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { toBoundedBigInt } from '@vultisig/lib-utils/bigint/toBoundedBigInt'
import { toBoundedLong } from '@vultisig/lib-utils/bigint/toBoundedLong'
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

  // A dApp-supplied XRPL transaction arrives as JSON in `signData.signRipple`
  // and is signed verbatim, letting types the payload cannot express — offers,
  // escrows — round-trip. Every signer rebuilds this input from the same JSON,
  // so each party serializes identical bytes. Nothing is reconstructed from the
  // payload's toAddress / toAmount (which cannot describe an offer); this
  // resolver is instead the fail-closed chokepoint that binds the raw
  // transaction to the signing vault (the `Account` check below) and, for
  // Payments, to the reviewed destination and amount.
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

    if (typeof parsed.data !== 'object' || parsed.data === null) {
      throw new Error('signRipple rawJson is not a transaction object')
    }
    const tx = parsed.data as Record<string, unknown>

    // Fail closed: the signed transaction must spend from the vault whose key
    // is signing. On XRPL the `Account` field is the sender, so every signer
    // — including a Secure Vault co-signer that only sees this payload —
    // rejects a raw transaction whose `Account` is anything but `coin.address`.
    // Without this the review surface and the signed bytes could diverge: a
    // payload could present one account/destination in its metadata while
    // `rawJson` moves a different account's funds. This bounds every signable
    // Ripple transaction to this vault's own funds regardless of the caller.
    if (tx.Account !== account) {
      throw new Error('signRipple rawJson Account does not match the signing account')
    }

    // The Account check alone cannot stop a same-account swap: a rawJson
    // Payment from this vault could name a different Destination/Amount than
    // the reviewed toAddress/toAmount. Payments ARE expressible by the payload
    // metadata, so for them the reviewed fields must bind to the signed bytes.
    // Non-Payment types (offers, escrows) have no payload representation and
    // pass on the Account check alone.
    if (tx.TransactionType === 'Payment') {
      if (tx.Destination !== keysignPayload.toAddress) {
        throw new Error('signRipple rawJson Destination does not match the reviewed toAddress')
      }

      const amountMismatch = new Error('signRipple rawJson Amount does not match the reviewed toAmount')
      const amount = tx.Amount
      if (typeof amount === 'string') {
        // Native XRP: Amount is a drops string (the XRPL JSON encoding).
        if (!coin.isNativeToken || amount !== keysignPayload.toAmount) {
          throw amountMismatch
        }
      } else if (typeof amount === 'object' && amount !== null) {
        // Issued currency: bind currency, issuer and value to the reviewed
        // coin. Values compare numerically so `1.5` and `1.50` don't diverge.
        if (coin.isNativeToken || !coin.contractAddress) {
          throw amountMismatch
        }
        const { currency, issuer } = parseRippleTokenId(coin.contractAddress)
        const iou = amount as Record<string, unknown>
        const matches =
          typeof iou.currency === 'string' &&
          toXrplCurrencyCode(iou.currency) === toXrplCurrencyCode(currency) &&
          iou.issuer === issuer &&
          typeof iou.value === 'string' &&
          attempt(() => parseIssuedCurrencyValue(iou.value as string)).data ===
            parseIssuedCurrencyValue(formatIssuedCurrencyValue(BigInt(keysignPayload.toAmount), coin.decimals))
        if (!matches) {
          throw amountMismatch
        }
      } else {
        // Missing Amount (or an unrepresentable encoding) cannot be reviewed.
        throw amountMismatch
      }
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
          value: formatIssuedCurrencyValue(
            toBoundedBigInt(keysignPayload.toAmount, { bits: 128, signed: false }),
            coin.decimals
          ),
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
        // Unlike the two Payment PROTO paths (int64 field, so signedness must
        // match), this is a plain JSON string: XRP drops are non-negative, so
        // reject a negative amount here instead of building JSON that XRPL
        // would bounce after the MPC ceremony already ran.
        Amount: toBoundedLong(keysignPayload.toAmount, { unsigned: true }).toString(),
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
        amount: toBoundedLong(keysignPayload.toAmount, { unsigned: false }),
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
    ...(getRawJson() ?? getTrustSet() ?? getPayment()),
  })

  return [input]
}
