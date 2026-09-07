import { create } from '@bufbuild/protobuf'
import { getRippleAccountInfo } from '@vultisig/core-chain/chains/ripple/account/info'
import { getRippleAccountLines } from '@vultisig/core-chain/chains/ripple/account/lines'
import { parseRippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { findRippleTrustLine } from '@vultisig/core-chain/chains/ripple/trustLine'
import { getRippleNetworkInfo } from '@vultisig/core-chain/chains/ripple/network/info'
import {
  RippleSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'

import { BuildKeysignPayloadError } from '../../error'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { originatesRippleTrustSet } from '../../utils/isRippleTrustSet'
import { resolveDestinationTag } from '../../utils/rippleDestinationTag'
import { GetChainSpecificResolver } from '../resolver'

const minProtocolFee = 15n
const baseFeeMultiplier = 2n
const rippleRequireDestinationTagFlag = 0x00020000
const lastLedgerSequenceOffset = 60

/**
 * `AccountRoot.TransferRate` encoding for "no transfer fee". The field is
 * absent or zero on most issuers; anything above this billionths-denominated
 * unit rate means the issuer charges a fee on every hop.
 * @see https://xrpl.org/docs/concepts/tokens/transfer-fees
 */
const rippleNoTransferFeeRate = 1_000_000_000

type AssertRippleTokenIsDeliverableInput = {
  /** Human ticker, used only to name the token in the rejection messages. */
  ticker: string
  senderAddress: string
  toAddress: string
  issuedCurrency: ReturnType<typeof parseRippleTokenId>
}

/**
 * Rejects an issued-currency Payment the XRP Ledger would refuse to deliver,
 * while the payload is still being built.
 *
 * Both shapes it catches are *applied* transactions on-ledger: the fee is
 * burned and the sequence consumed even though nothing moves. A destination
 * holding no trust line for the exact (currency, issuer) fails with
 * tecNO_LINE/tecPATH_DRY, and an issuer charging a TransferRate fails with
 * tecPATH_PARTIAL because the sender owes `Amount x (1 + rate)` while XRPL
 * defaults SendMax to Amount alone.
 *
 * Fails closed: a lookup that does not come back is not evidence of a usable
 * trust line, and those failures stay retryable rather than becoming a
 * [BuildKeysignPayloadError].
 *
 * Not for redemptions — sending a token back to its own issuer needs no trust
 * line and pays no transfer fee. Callers skip it in that case.
 */
const assertRippleTokenIsDeliverable = async ({
  ticker,
  senderAddress,
  toAddress,
  issuedCurrency,
}: AssertRippleTokenIsDeliverableInput): Promise<void> => {
  const [linesResult, issuerResult] = await Promise.all([
    attempt(getRippleAccountLines(toAddress)),
    // An issuer never charges itself a transfer fee on its own token.
    senderAddress === issuedCurrency.issuer ? undefined : attempt(getRippleAccountInfo(issuedCurrency.issuer)),
  ])

  if ('error' in linesResult) {
    throw new Error(`Unable to verify whether XRP destination ${toAddress} holds a trust line for ${ticker}`)
  }

  if (!findRippleTrustLine({ lines: linesResult.data, ...issuedCurrency })) {
    throw new BuildKeysignPayloadError(
      'ripple-destination-trust-line-missing',
      `Cannot send ${ticker} to ${toAddress}: that account holds no trust line for this token, ` +
        'so the XRP Ledger would reject the payment. The recipient has to open one first.'
    )
  }

  if (issuerResult === undefined) {
    return
  }

  if ('error' in issuerResult) {
    throw new Error(`Unable to verify whether the ${ticker} issuer charges an XRP transfer fee`)
  }

  const { TransferRate } = issuerResult.data.account_data
  if (TransferRate !== undefined && TransferRate > rippleNoTransferFeeRate) {
    throw new BuildKeysignPayloadError(
      'ripple-issuer-transfer-fee-unsupported',
      `Cannot send ${ticker}: its issuer charges a transfer fee, which needs a SendMax this ` +
        'payload cannot express yet. Sending it back to the issuer still works.'
    )
  }
}

export const getRippleLastLedgerSequence = (ledgerCurrentIndex: number | undefined): bigint => {
  if (ledgerCurrentIndex === undefined || !Number.isSafeInteger(ledgerCurrentIndex) || ledgerCurrentIndex <= 0) {
    throw new Error('Ripple account_info response is missing a valid ledger_current_index.')
  }

  return BigInt(ledgerCurrentIndex + lastLedgerSequenceOffset)
}

/**
 * Resolves the per-ceremony XRPL fields — sequence, network fee, ledger
 * validity window, destination tag and the operation discriminator — and
 * refuses, before the user reviews anything, a transaction the ledger would
 * apply without delivering: a Payment missing a required DestinationTag, a
 * native send too small to activate a fresh destination, and an issued-currency
 * Payment whose destination or issuer cannot receive it.
 *
 * Deterministic bad input surfaces as a [BuildKeysignPayloadError] so callers
 * stop retrying; lookups that merely failed stay retryable.
 */
export const getRippleChainSpecific: GetChainSpecificResolver<'rippleSpecific'> = async ({
  keysignPayload,
  destinationTag,
  transactionType,
}) => {
  const coin = getKeysignCoin(keysignPayload)
  const { address } = coin

  // A dApp-supplied transaction (OfferCreate, OfferCancel, …) carries no
  // `toAddress`: the base-reserve check below is specific to a Payment that
  // funds a destination, so skip the destination fetch when there isn't one.
  // Fee and sequence come from the sender account and are unaffected.
  const toAddress = keysignPayload.toAddress || undefined

  const effectiveDestinationTag = resolveDestinationTag({
    destinationTag,
    memo: keysignPayload.memo,
  })
  // Preserve existing trust-line callers, but an ordinary send explicitly
  // selects Payment: sending tokens back to their issuer is also a Payment.
  const isTrustSet =
    transactionType === undefined
      ? originatesRippleTrustSet(keysignPayload)
      : transactionType === TransactionType.RIPPLE_TRUST_SET

  // A verbatim dApp transaction is signed exactly as supplied, so the token
  // pre-flights below — which describe a Payment this resolver would build —
  // do not apply to it.
  const isVerbatimDappTx = keysignPayload.signData.case === 'signRipple'
  const isIssuedCurrencySend =
    !isTrustSet && !isVerbatimDappTx && !!keysignPayload.coin && !keysignPayload.coin.isNativeToken

  // A payload with no parseable token id cannot name an asset to pre-flight.
  // The signing-input resolver rejects that shape outright; here it only means
  // there is nothing to look up.
  const tokenId = isIssuedCurrencySend ? coin.id : undefined
  const issuedCurrency = tokenId
    ? withFallback(
        attempt(() => parseRippleTokenId(tokenId)),
        undefined
      )
    : undefined

  // Sending a token back to its issuer redeems it: the issuer needs no trust
  // line to itself and charges no transfer fee, so neither pre-flight applies.
  const redeemsToIssuer = issuedCurrency !== undefined && toAddress === issuedCurrency.issuer

  const [senderAccount, networkInfo, destinationAccountResult] = await Promise.all([
    getRippleAccountInfo(address),
    getRippleNetworkInfo(),
    toAddress ? attempt(getRippleAccountInfo(toAddress)) : undefined,
  ])

  const { validated_ledger, load_factor, load_base } = networkInfo
  const { base_fee, reserve_base } = shouldBePresent(validated_ledger)

  const computedFee = ((BigInt(base_fee) * BigInt(load_factor)) / BigInt(load_base)) * baseFeeMultiplier

  const networkFee = maxBigInt(computedFee, minProtocolFee)

  // XRPL base reserve is a requirement on the Payment AMOUNT (the drops that
  // fund/activate the destination account), NOT on the Fee. The Fee is BURNED
  // by the network — it never reaches the recipient. The previous code added
  // reserve_base to `gas` (which becomes TW.Ripple SigningInput.fee), so every
  // send to a not-yet-activated XRP address burned ~1 XRP (the reserve) for
  // nothing, on top of the actual send amount. Reserve spec:
  // https://xrpl.org/docs/concepts/accounts/reserves
  const destinationUnfunded =
    destinationAccountResult !== undefined &&
    'error' in destinationAccountResult &&
    isInError(destinationAccountResult.error, 'Account not found')

  // XRP Ledger rejects a Payment to an account with lsfRequireDestTag when no
  // tag is present. Fail closed on lookup errors other than an unfunded
  // destination: without an account object there is no RequireDestTag flag.
  if (toAddress && destinationAccountResult !== undefined && !isTrustSet && effectiveDestinationTag === undefined) {
    if ('error' in destinationAccountResult) {
      if (!destinationUnfunded) {
        // This lookup can fail transiently, so keep it retryable. Only
        // deterministic user-input failures use BuildKeysignPayloadError.
        throw new Error(`Unable to verify whether XRP destination ${toAddress} requires a DestinationTag`)
      }
    } else if ((destinationAccountResult.data.account_data.Flags & rippleRequireDestinationTagFlag) !== 0) {
      throw new BuildKeysignPayloadError(
        'ripple-destination-tag-required',
        `XRP destination ${toAddress} requires a DestinationTag`
      )
    }
  }

  if (destinationUnfunded) {
    // A TrustSet is addressed to the issuer, not to a payee. Saying "activate
    // it before sending tokens" would tell the user to fund somebody else's
    // account; an issuer that does not exist simply cannot be trusted.
    if (isTrustSet) {
      throw new BuildKeysignPayloadError(
        'ripple-trust-line-issuer-not-activated',
        `Cannot open an XRP trust line to ${toAddress}: that issuer account does not exist on the ledger.`
      )
    }
    if (!keysignPayload.coin?.isNativeToken) {
      throw new BuildKeysignPayloadError(
        'ripple-destination-not-activated',
        `Cannot send an XRP issued currency to ${toAddress}: the destination account is not activated. ` +
          'Activate it with the XRP base reserve before sending tokens.'
      )
    }
    const toAmount = BigInt(shouldBePresent(keysignPayload.toAmount))
    if (toAmount < BigInt(reserve_base)) {
      throw new Error(
        `Cannot send to XRP account ${toAddress}: it is not yet activated, and XRPL requires the ` +
          `Payment amount to be at least the base reserve (${reserve_base} drops) to create a new ` +
          `account. The send amount is ${toAmount.toString()} drops. Increase the amount to at least ` +
          `the reserve, or send to an already-activated account.`
      )
    }
  }

  if (issuedCurrency && toAddress && !redeemsToIssuer) {
    await assertRippleTokenIsDeliverable({
      ticker: coin.ticker,
      senderAddress: address,
      toAddress,
      issuedCurrency,
    })
  }

  const { account_data, ledger_current_index: ledgerCurrentIndex } = senderAccount

  // State the operation on the wire rather than leaving every signer to infer
  // it from the coin. A non-native Ripple coin means either "open a trust line"
  // or "send this token", and the two sign different bytes — a co-signer that
  // reads the undiscriminated case as a Payment diverges from the TrustSet
  // built here, and the ceremony never completes.
  //
  // Only genuine originations are declared. Stamping a token send would make
  // every signer agree to build a TrustSet from it, which is worse than the
  // divergence: the ceremony completes over an operation nobody asked for.
  return create(RippleSpecificSchema, {
    sequence: BigInt(account_data.Sequence),
    lastLedgerSequence: getRippleLastLedgerSequence(ledgerCurrentIndex),
    // Fee is the network fee only — the reserve rides on the Payment amount.
    gas: networkFee,
    ...(effectiveDestinationTag !== undefined ? { destinationTag: effectiveDestinationTag } : {}),
    ...(isTrustSet
      ? { transactionType: TransactionType.RIPPLE_TRUST_SET }
      : transactionType === TransactionType.RIPPLE_PAYMENT
        ? { transactionType: TransactionType.RIPPLE_PAYMENT }
        : {}),
  })
}
