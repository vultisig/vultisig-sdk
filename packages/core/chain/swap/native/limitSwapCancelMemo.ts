import { getLimitSwapSourceChainKind, limitSwapMemoByteLimit, LimitSwapSourceChainKind } from './limitSwapMemo'

/**
 * THORChain's modify-limit-swap prefix. Distinct from `limitSwapMemoPrefix`
 * (`=<:`), which PLACES an order — `m=<:` modifies one that is already resting.
 */
export const modifyLimitSwapMemoPrefix = 'm=<:'

/**
 * The `ModifiedTargetAmount` that means "cancel". THORNode branches on
 * `msg.ModifiedTargetAmount.IsZero()`; any other value re-targets the order
 * instead, which is a different action this module deliberately does not build.
 */
const cancelModifiedTargetAmount = '0'

/**
 * Whether `memo` MODIFIES a resting order — which includes, but is not limited
 * to, cancelling it.
 *
 * Named for what it matches. A cancel is the special case where the final field
 * is zero; a non-zero value re-targets. Only the cancel form is built here, so
 * today the two coincide — but a predicate that says "cancel" while matching
 * any modification is the kind of small lie that outlives the assumption that
 * made it true.
 */
export const isModifyLimitSwapMemo = (memo: string | undefined | null): boolean =>
  !!memo?.startsWith(modifyLimitSwapMemoPrefix)

/**
 * Whether `memo` CANCELS a resting order, rather than merely modifying one.
 *
 * The final field is compared NUMERICALLY, the way THORNode's `getUint` reads
 * it: `"00"` is zero there, and a string comparison would call that a retarget.
 * Digits only, so a sign cannot smuggle `"-0"` past an unsigned field.
 */
export const isCancelLimitSwapMemo = (memo: string | undefined | null): boolean => {
  if (!isModifyLimitSwapMemo(memo) || !memo) {
    return false
  }
  const fields = memo.split(':')
  const modifiedTarget = fields[fields.length - 1]
  if (!modifiedTarget || !/^\d+$/.test(modifiedTarget)) {
    return false
  }
  return BigInt(modifiedTarget) === 0n
}

/**
 * Everything the cancel memo needs, reduced to the exact integers THORChain
 * itself holds. Amounts are bigint so a caller cannot pass an unparsed or
 * negative value.
 */
export type LimitSwapCancelInputs = {
  /**
   * THORChain memo form of the order's SOURCE asset.
   *
   * Must carry the token's FULL contract (`ETH.USDC-0XA0B86991…`), never the
   * placement memo's 6-character abbreviation — see `buildCancelLimitSwapMemo`.
   *
   * Must be the asset's SECURED denom (`eth-usdc-0xa0b…`) when the source is a
   * secured asset, never its layer-1 form. `MsgModifyLimitSwap.ValidateBasic`
   * enforces `From.IsChain(Source.Asset.GetChain())`, and `GetChain()` returns
   * THORChain only for synth, trade and secured assets. The layer-1 spelling
   * makes it report the L1 chain, and a cancel sent from a THOR address is then
   * rejected outright at validation.
   */
  sourceAsset: string
  /** The order's deposited source amount, in THORChain's 1e8 fixed point. */
  sourceAmount: bigint
  /** THORChain memo form of the TARGET asset, under the same full-spelling rule. */
  targetAsset: string
  /** The order's ORIGINAL trade target (the placement memo's LIM), in 1e8. */
  tradeTarget: bigint
}

/**
 * Shortest token identifier a cancel memo will accept.
 *
 * An EVM contract is 42 characters (`0X` + 40 hex) and the placement memo's
 * abbreviation is 6, so anything between is a wide, unambiguous gap. Fixed at a
 * length rather than an exact `0X…` pattern so a future asset flavour with a
 * differently-shaped identifier is not rejected out of hand — the job is to
 * catch truncation, not to validate contract syntax.
 */
const minimumFullTokenIdentifierLength = 20

/** Every separator a THORChain memo asset can use: L1, synth, trade, secured. */
const assetSeparators = ['.', '/', '~', '-']

/**
 * Whether a memo asset carries a TRUNCATED token identifier —
 * `ETH.USDC-06EB48` rather than `ETH.USDC-0XA0B86991…`.
 *
 * The chain prefix has to be stripped first, and cannot be assumed to end at a
 * `.`: a SECURED asset spells the whole thing with `-`, so a secured native
 * denom is `btc-btc` and a secured token is `eth-usdc-0xa0b…`. Reading the tail
 * after the last `-` would call the first of those truncated and make every
 * secured-native order uncancellable.
 *
 * So: drop everything up to the first separator — that is the chain — and look
 * at the SYMBOL that follows. A symbol is `TICKER` or `TICKER-<identifier>`,
 * and only the second form can be truncated. `BTC.BTC`, `THOR.RUNE` and
 * `btc-btc` carry no identifier at all and are full by construction.
 */
export const isAbbreviatedThorchainMemoAsset = (asset: string): boolean => {
  const chainEnd = [...asset].findIndex(char => assetSeparators.includes(char))
  const symbol = chainEnd === -1 ? asset : asset.slice(chainEnd + 1)
  const identifierStart = symbol.indexOf('-')
  if (identifierStart === -1) {
    return false
  }
  return symbol.slice(identifierStart + 1).length < minimumFullTokenIdentifierLength
}

export const limitSwapCancelMemoErrors = ['emptyAsset', 'nonPositiveAmount', 'abbreviatedAsset'] as const

export type LimitSwapCancelMemoError = (typeof limitSwapCancelMemoErrors)[number]

export class LimitSwapCancelMemoBuildError extends Error {
  readonly reason: LimitSwapCancelMemoError

  constructor(reason: LimitSwapCancelMemoError, message: string) {
    super(message)
    this.reason = reason
    this.name = 'LimitSwapCancelMemoBuildError'
  }
}

/**
 * Both amounts must be positive, for every consumer of these inputs.
 *
 * Shared because two modules depend on it for different reasons: the memo would
 * encode a coin THORNode cannot parse, and the bucket key divides by the trade
 * target — where a zero would raise `RangeError` rather than a domain error a
 * caller can branch on.
 */
export const assertPositiveLimitSwapCancelAmounts = ({
  sourceAmount,
  tradeTarget,
}: Pick<LimitSwapCancelInputs, 'sourceAmount' | 'tradeTarget'>): void => {
  if (sourceAmount <= 0n || tradeTarget <= 0n) {
    throw new LimitSwapCancelMemoBuildError(
      'nonPositiveAmount',
      `limit order cancel: amounts must be positive, got source ${sourceAmount} and trade target ${tradeTarget}`
    )
  }
}

/**
 * Build the `m=<` memo that cancels a resting limit order.
 *
 *     m=<:<SRC_AMOUNT><SRC_ASSET>:<TRADE_TARGET><TGT_ASSET>:0
 *
 * Both coins are `<amount><ASSET>` with NO space — THORNode's `getCoin` scans
 * leading digits and splices the space back in before parsing.
 *
 * Three properties, each of which causes a SILENT no-op if broken — the cancel
 * is accepted, costs a fee, matches nothing, and looks exactly like success:
 *
 * - **Assets are spelled in FULL.** `processOneTxIn` runs every other inbound
 *   memo through `fuzzyAssetMatch`, which is what lets a placement say
 *   `ETH.USDC-06EB48` and still be indexed under the full contract.
 *   `ModifyLimitSwapMemo` is the exception: its asset string builds the lookup
 *   key verbatim, so an abbreviation addresses a bucket that by construction
 *   holds nothing. Enforced here, not merely documented.
 * - **Amounts are plain decimal integers.** The placement memo's LIM goes
 *   through `getUintWithScientificNotation` and understands `544e6`; these
 *   coins go through `cosmos.ParseCoins`, which does not.
 * - **Both amounts are exact.** THORNode does not compare them directly — they
 *   feed the ratio its index key is built from (see
 *   `getThorchainLimitOrderBucketKey`), and one unit of drift lands in a
 *   different bucket.
 */
export const buildCancelLimitSwapMemo = (inputs: LimitSwapCancelInputs): string => {
  const { sourceAmount, tradeTarget } = inputs
  // Trimmed once and used throughout: validating the trimmed form while
  // emitting the raw one would let ' THOR.RUNE' produce `100000000 THOR.RUNE`,
  // and THORNode's getCoin splices its own space in — so the stray one corrupts
  // the coin field and the cancel matches nothing.
  const sourceAsset = inputs.sourceAsset.trim()
  const targetAsset = inputs.targetAsset.trim()

  if (!sourceAsset || !targetAsset) {
    throw new LimitSwapCancelMemoBuildError('emptyAsset', 'cancel memo: source and target assets are required')
  }
  assertPositiveLimitSwapCancelAmounts({ sourceAmount, tradeTarget })
  if (isAbbreviatedThorchainMemoAsset(sourceAsset) || isAbbreviatedThorchainMemoAsset(targetAsset)) {
    throw new LimitSwapCancelMemoBuildError(
      'abbreviatedAsset',
      `cancel memo: assets must carry their full token identifier, got ${JSON.stringify(sourceAsset)} and ${JSON.stringify(targetAsset)}. ` +
        'This memo type skips fuzzyAssetMatch, so an abbreviation would address a bucket holding no order.'
    )
  }

  const source = `${sourceAmount}${sourceAsset}`
  const target = `${tradeTarget}${targetAsset}`
  return `${modifyLimitSwapMemoPrefix}${source}:${target}:${cancelModifiedTargetAmount}`
}

/**
 * Whether a cancel memo fits the per-transaction budget of the chain it will be
 * sent from.
 *
 * In practice this rules out an ERC20 target from a UTXO source: two
 * full-contract assets plus two exact amounts overflow the 80-byte OP_RETURN
 * cap, and NOTHING in a cancel memo can be shortened — the amounts define the
 * bucket, short codes are rejected by `cosmos.ParseCoins`, and this memo type
 * skips `fuzzyAssetMatch`. Such an order still refunds automatically at expiry.
 */
export const doesCancelLimitSwapMemoFit = (memo: string, sourceChainKind: LimitSwapSourceChainKind): boolean =>
  new TextEncoder().encode(memo).length <= limitSwapMemoByteLimit[sourceChainKind]

/** Convenience: the byte-cap check keyed off the source asset's memo notation. */
export const doesCancelLimitSwapMemoFitSourceAsset = (memo: string, sourceAsset: string): boolean =>
  doesCancelLimitSwapMemoFit(memo, getLimitSwapSourceChainKind(sourceAsset))
