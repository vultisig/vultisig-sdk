import { Buffer } from 'buffer'
import {
  formatIssuedCurrencyValue,
  getSignableIssuedCurrencyAmount,
  parseIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { attempt } from '@vultisig/lib-utils/attempt'
import { assertBoundedInt } from '@vultisig/lib-utils/bigint/assertBoundedInt'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { TransactionType } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
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
  const normalizedCurrency = attempt(() => toXrplCurrencyCode(currency))
  if ('error' in normalizedCurrency) {
    return undefined
  }
  return {
    kind: 'issued',
    currency: normalizedCurrency.data,
    issuer,
    units: parsed.data,
  }
}

// True only if `deliverMin` is the same asset as `amount` (native XRP, or the
// same issued-currency code + issuer) and exactly matches its value. On XRPL a
// partial payment's `Amount` is the delivery maximum, so `DeliverMin > Amount`
// is unsatisfiable rather than a stricter guarantee. A different currency, or a
// lower/higher floor in the same currency, means the reviewed `toAmount` no
// longer describes a valid guaranteed outcome.
const deliverMinExactlyMatchesReviewedAmount = (deliverMin: ParsedXrplAmount, amount: ParsedXrplAmount): boolean => {
  if (deliverMin.kind === 'native' || amount.kind === 'native') {
    return deliverMin.kind === 'native' && amount.kind === 'native' && deliverMin.units === amount.units
  }
  return (
    deliverMin.currency === amount.currency && deliverMin.issuer === amount.issuer && deliverMin.units === amount.units
  )
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
        if (
          !parsedAmount ||
          !parsedDeliverMin ||
          !deliverMinExactlyMatchesReviewedAmount(parsedDeliverMin, parsedAmount)
        ) {
          throw new Error(
            'signRipple rawJson sets tfPartialPayment without a DeliverMin that guarantees the reviewed amount'
          )
        }
      }
    }

    return { rawJson }
  }

  const getIssuedCurrencyAmount = (): TW.Ripple.Proto.CurrencyAmount | undefined => {
    if (coin.isNativeToken) {
      return undefined
    }

    if (!coin.contractAddress) {
      throw new Error('XRP issued-currency operation requires a coin carrying a token id')
    }

    const { currency, issuer } = parseRippleTokenId(coin.contractAddress)

    const amount = BigInt(keysignPayload.toAmount)
    if (!isRippleTrustSet(keysignPayload) && amount === 0n) {
      throw new Error('XRP issued-currency Payment amount must be positive')
    }
    return TW.Ripple.Proto.CurrencyAmount.create(
      getSignableIssuedCurrencyAmount({
        currency,
        issuer,
        amount,
        decimals: coin.decimals,
      })
    )
  }

  const rawJson = getRawJson()
  const issuedCurrencyAmount = rawJson ? undefined : getIssuedCurrencyAmount()

  // A TrustSet opens or modifies a trust line, and the keysign amount is its
  // LIMIT rather than a transfer. The coin shape cannot distinguish it from an
  // issued-currency Payment, so the operation discriminator is authoritative.
  // A signer that predates the discriminator will infer TrustSet for the same
  // token Payment and derive different signing bytes: MPC then fails closed
  // instead of completing a different operation than the initiator reviewed.
  const getTrustSet = (): Pick<TW.Ripple.Proto.ISigningInput, 'opTrustSet'> | undefined => {
    if (!isRippleTrustSet(keysignPayload)) {
      return undefined
    }

    if (!issuedCurrencyAmount) {
      throw new Error('XRP TrustSet requires an issued-currency coin carrying a token id')
    }
    if (keysignPayload.toAddress !== issuedCurrencyAmount.issuer) {
      throw new Error('XRP TrustSet destination does not match the issued-currency issuer')
    }

    return {
      opTrustSet: TW.Ripple.Proto.OperationTrustSet.create({
        limitAmount: issuedCurrencyAmount,
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

      const paymentAmount = issuedCurrencyAmount
        ? {
            currency: issuedCurrencyAmount.currency,
            issuer: issuedCurrencyAmount.issuer,
            value: issuedCurrencyAmount.value,
          }
        : keysignPayload.toAmount

      const txJson = {
        TransactionType: 'Payment',
        Account: account,
        Destination: keysignPayload.toAddress,
        Amount: paymentAmount,
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
        ...(issuedCurrencyAmount
          ? { currencyAmount: issuedCurrencyAmount }
          : { amount: Long.fromString(keysignPayload.toAmount) }),
        ...(destinationTag === undefined ? {} : { destinationTag: Long.fromNumber(destinationTag) as any }),
      }),
    }
  }

  if (
    keysignPayload.signData.case !== 'signRipple' &&
    ![TransactionType.UNSPECIFIED, TransactionType.RIPPLE_TRUST_SET].includes(rippleSpecific.transactionType)
  ) {
    throw new Error(`Unsupported XRP transaction type: ${rippleSpecific.transactionType}`)
  }

  const input = TW.Ripple.Proto.SigningInput.create({
    account,
    // sdk#1200: bound before Long.fromString rather than letting an out-of-
    // range magnitude silently two's-complement-wrap the signed int64 fee.
    fee: Long.fromString(assertBoundedInt(gas.toString(), 'int64')),
    sequence: Number(sequence),
    lastLedgerSequence: Number(lastLedgerSequence),
    publicKey: getKeysignTwPublicKey(keysignPayload),
    ...(rawJson ?? getTrustSet() ?? getPayment()),
  })

  return [input]
}
