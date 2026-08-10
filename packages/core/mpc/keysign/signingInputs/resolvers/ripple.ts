import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  parseIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { attempt } from '@vultisig/lib-utils/attempt'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignTwPublicKey } from '../../tw/getKeysignTwPublicKey'
import { isRippleTrustSet } from '../../utils/isRippleTrustSet'
import { getLegacyDestinationTag, resolveDestinationTag } from '../../utils/rippleDestinationTag'
import { SigningInputsResolver } from '../resolver'

// tfPartialPayment on an XRPL Payment. It redefines `Amount` from a guaranteed
// delivery into a maximum, leaving `delivered_amount` in the executed
// transaction's metadata as the only record of what actually moved.
const tfPartialPayment = 0x00020000

// A well-formed, strictly positive XRPL amount — a drops string or an
// issued-currency object — normalised so two amounts can be compared. `null`,
// `{}` and zero all satisfy "the field is present" while bounding nothing, so
// presence alone cannot stand in for a floor: this parses to `undefined` for
// anything that isn't an actual positive quantity.
type ParsedXrplAmount =
  | { kind: 'native'; units: bigint }
  | { kind: 'issued'; currency: string; issuer: string; units: bigint }

const parseXrplAmount = (value: unknown): ParsedXrplAmount | undefined => {
  if (typeof value === 'string') {
    const drops = attempt(() => BigInt(value))
    if ('error' in drops || drops.data <= 0n) {
      return undefined
    }
    return { kind: 'native', units: drops.data }
  }

  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const { currency, issuer, value: issuedValue } = value as Record<string, unknown>
  if (typeof currency !== 'string' || typeof issuer !== 'string' || typeof issuedValue !== 'string') {
    return undefined
  }

  const parsed = attempt(() => parseIssuedCurrencyValue(issuedValue))
  if ('error' in parsed || parsed.data <= 0n) {
    return undefined
  }
  return { kind: 'issued', currency: toXrplCurrencyCode(currency), issuer, units: parsed.data }
}

// True only if `deliverMin` is the same asset as `amount` (native XRP, or the
// same issued-currency code + issuer) and guarantees at least as much value.
// A DeliverMin in a different currency, or a currency-matched one that floors
// less than the reviewed Amount, leaves the recipient able to receive less
// than what the reviewer approved — which a positive-but-unrelated floor does
// not prevent.
const deliversAtLeastReviewedAmount = (deliverMin: ParsedXrplAmount, amount: ParsedXrplAmount): boolean => {
  if (deliverMin.kind === 'native' || amount.kind === 'native') {
    return deliverMin.kind === 'native' && amount.kind === 'native' && deliverMin.units >= amount.units
  }
  return deliverMin.currency === amount.currency && deliverMin.issuer === amount.issuer && deliverMin.units >= amount.units
}

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
  // Payments, to the reviewed destination and amount — including refusing the
  // flags that would quietly unbind that amount again.
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

      // The Amount binding just established only means something while Amount
      // is a delivery. tfPartialPayment turns it into a ceiling: the ledger
      // hands over whatever the path can source and records the real figure
      // only in the executed transaction's metadata, so the reviewed toAmount
      // stops describing what the recipient gets while the sender can still be
      // charged the full SendMax. A DeliverMin that merely exists and is
      // positive is not a floor the reviewer approved — a dApp can bind Amount
      // to the reviewed toAmount while DeliverMin permits delivering a dust
      // fraction of it. Only a DeliverMin that guarantees the full reviewed
      // Amount (same asset, at least as much value) restores what the review
      // screen promised; without one there is nothing left to bind, so refuse
      // rather than sign an outcome no reviewer could have seen. Flags we
      // cannot read as a uint32 are refused for the same reason — they may
      // carry the very bit checked here.
      const flags = tx.Flags === undefined ? 0 : tx.Flags
      if (typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) {
        throw new Error('signRipple rawJson Flags is not a uint32 bitmask')
      }

      if ((flags & tfPartialPayment) !== 0) {
        const parsedAmount = parseXrplAmount(amount)
        const parsedDeliverMin = parseXrplAmount(tx.DeliverMin)
        if (!parsedAmount || !parsedDeliverMin || !deliversAtLeastReviewedAmount(parsedDeliverMin, parsedAmount)) {
          throw new Error(
            'signRipple rawJson sets tfPartialPayment without a DeliverMin that guarantees the reviewed amount'
          )
        }
      }
    }

    return { rawJson }
  }

  // A TrustSet opens or modifies a trust line, and the keysign amount is its
  // LIMIT rather than a transfer. `RippleSpecific.transaction_type` says so
  // explicitly; when it is absent the coin's shape decides, which is how every
  // signer shipped before that field behaves — honouring it keeps a TrustSet
  // byte-identical across a mixed-version committee. Native XRP falls through
  // to the Payment path below.
  const getTrustSet = (): Pick<TW.Ripple.Proto.ISigningInput, 'opTrustSet'> | undefined => {
    if (!isRippleTrustSet(keysignPayload)) {
      return undefined
    }

    if (coin.isNativeToken || !coin.contractAddress) {
      throw new Error('XRP TrustSet requires an issued-currency coin carrying a token id')
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
    ...(getRawJson() ?? getTrustSet() ?? getPayment()),
  })

  return [input]
}
