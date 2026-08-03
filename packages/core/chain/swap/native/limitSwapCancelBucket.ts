import { assertPositiveLimitSwapCancelAmounts, LimitSwapCancelInputs } from './limitSwapCancelMemo'
import { findThorchainMemoAssetSeparatorIndex } from './thorchainMemoAsset'

/**
 * THORChain's fixed-point exponent, the `1e8` the ratio is scaled by.
 */
const thorchainFixedPointExponent = 8n

/**
 * THORNode's `ratioLength`. Its own comment: "a value of 18 means that
 * granularity is maxed out at 1 trillion to 1 ratio". Changing it on their side
 * is a kvstore migration, so it is safe to pin.
 */
const thorchainRatioLength = 18

/**
 * Collapse a memo asset to its layer-1 form, the way `Asset.GetLayer1Asset()`
 * does when THORNode builds the queue index key.
 *
 * On their side this clears the synth/trade/secured flags while keeping chain
 * and symbol; on the wire those flavours are spelled with `/`, `~` and `-`
 * where the L1 asset uses `.`. So: the FIRST separator becomes `.`, and the
 * result is upper-cased (secured denoms arrive lower-case).
 *
 * An asset already in L1 form is left alone — its first separator IS the `.`,
 * and the `-` in a contract-suffixed asset like `ETH.USDC-0XA0B…` comes after
 * it, so it must not be touched.
 */
export const toThorchainLayer1MemoAsset = (asset: string): string => {
  const index = findThorchainMemoAssetSeparatorIndex(asset)
  if (index === -1 || asset[index] === '.') {
    return asset.toUpperCase()
  }
  return `${asset.slice(0, index)}.${asset.slice(index + 1)}`.toUpperCase()
}

/**
 * Normalise a ratio the way THORNode's `rewriteRatio` does.
 *
 * Not cosmetic: short ratios are zero-padded so keys sort in numeric order, and
 * longer ones are TRUNCATED from the right, which deliberately collapses very
 * large ratios into one bucket. Both behaviours have to be reproduced or a
 * duplicate check disagrees with the chain at exactly the extremes where it
 * matters.
 */
const rewriteThorchainRatio = (ratio: string): string =>
  ratio.length < thorchainRatioLength ? ratio.padStart(thorchainRatioLength, '0') : ratio.slice(0, thorchainRatioLength)

/**
 * Reproduce THORNode's advanced-swap-queue index key for a limit order — the
 * tuple that decides which orders are mutually indistinguishable to a cancel.
 *
 * Mirrors `getAdvSwapQueueIndexKey` + `getRatio` + `rewriteRatio`:
 *
 *     ratio = (sourceAmount × 1e8) / tradeTarget      // integer division
 *     key   = "<l1Source>><l1Target>/<ratio normalised to 18 chars>/"
 *
 * THORNode scans this bucket for a swap whose `FromAddress` matches the sender
 * and takes the FIRST match — orders are never addressed by tx hash. So two
 * orders reducing to the same key are not independently cancellable.
 */
export const getThorchainLimitOrderBucketKey = ({
  sourceAsset,
  sourceAmount,
  targetAsset,
  tradeTarget,
}: LimitSwapCancelInputs): string => {
  // Exported separately from the memo builder, so it can be reached before any
  // memo is validated — `areLimitOrdersCancelIndistinguishable` runs it over
  // stored orders. A zero trade target would make bigint division raise
  // `RangeError`, crashing a duplicate check that is supposed to fail closed;
  // the shared assertion raises the same typed error the sibling modules do, so
  // a caller can branch on `reason` rather than string-matching.
  assertPositiveLimitSwapCancelAmounts({ sourceAmount, tradeTarget })

  const ratio = (sourceAmount * 10n ** thorchainFixedPointExponent) / tradeTarget
  const source = toThorchainLayer1MemoAsset(sourceAsset)
  const target = toThorchainLayer1MemoAsset(targetAsset)
  return `${source}>${target}/${rewriteThorchainRatio(ratio.toString())}/`
}

/**
 * Whether two orders would be addressed by the same cancel.
 *
 * Compared on the bucket key, NOT on equal amounts: two orders with different
 * deposits and different trade targets collide whenever their ratio matches
 * (selling 1 and selling 2 at the same price land in one bucket). Comparing
 * amounts for equality would under-report exactly the duplicates a user most
 * needs warning about.
 *
 * Assets are layer-1-normalised because THORNode's key is — a secured or synth
 * representation and the plain L1 asset collapse to the same key on-chain.
 *
 * Deliberately tuned to over-report: warning that two orders might be confused
 * when they would not be is a mild annoyance, whereas missing a real collision
 * means the wrong order closes with no warning at all.
 */
export const areLimitOrdersCancelIndistinguishable = (a: LimitSwapCancelInputs, b: LimitSwapCancelInputs): boolean =>
  getThorchainLimitOrderBucketKey(a) === getThorchainLimitOrderBucketKey(b)
