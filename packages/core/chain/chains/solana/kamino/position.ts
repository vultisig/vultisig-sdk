import { KaminoShareAmount, kaminoShareAmount, kaminoShareAmountFromDecimalString, scaleKaminoRate } from './amount'
import { KaminoUserPositionResponse } from './models'
import { compareKaminoRates, kaminoRateEquals, parseKaminoRate, sumKaminoRates } from './rate'

/**
 * The user's share balance in one vault, split the way `/positions` reports
 * it.
 *
 * Shares, never tokens: the withdraw endpoint takes shares and the balance a
 * full withdraw must send is a share count. The token figure a form is
 * denominated in is a projection of these at the current rate, and it is
 * derived — never the other way round.
 */
export type KaminoSharePosition = {
  staked: KaminoShareAmount
  unstaked: KaminoShareAmount
  total: KaminoShareAmount
  /**
   * The largest share amount `POST /ktx/kvault/withdraw` will size as a share
   * count rather than rewriting to `u64::MAX` — its *withdraw everything*
   * sentinel.
   *
   * The sentinel fires at greater-than-**or-equal-to** the spendable balance,
   * not merely above it. That was measured, not assumed, on wallets whose
   * balance is an exact `u64` in a token account, so there is no rounding
   * anywhere in the comparison. So "the whole balance" is not a request this
   * API accepts, and the maximum has to be the largest amount strictly
   * beneath it.
   *
   * Truncating the reported string is necessary and NOT sufficient. It gives a
   * value strictly below the balance only when there were digits past the
   * mint's scale to throw away; when the balance is exactly representable the
   * truncation IS the balance, and asking for it is asking for everything. So
   * the exact case gives up one base unit — `10^-6` of a share, worth about a
   * ten-thousandth of a cent on the launch vaults — and the inexact case does
   * not have to.
   */
  spendable: KaminoShareAmount
  /**
   * Whether the two reported parts add up to the reported total.
   *
   * A response whose total exceeds its parts has shares it has not accounted
   * for, and a withdraw flow has to know exactly how the position is split:
   * the unstaked half is what decides how many shares the farm is asked to
   * release, and a request built against a wrong split is one the API will
   * answer with a different transaction from the one being checked for.
   *
   * Compared at the API's OWN precision, never at the share mint's scale.
   * Truncating three strings to six decimals and adding two of them can miss
   * the third by a base unit with nothing wrong — `0.9445485 + 0.9595935`
   * truncates to `944548 + 959593`, one short of `1904142` — and refusing a
   * real position over a last decimal place is not a guard, it is a bug.
   */
  accountsForItsTotal: boolean
  /**
   * Whether the three reported numbers can all be true at once. A response
   * whose parts sum past its total says the user holds more shares than they
   * hold — figures that cannot be spent as a balance, and spending a balance
   * that is too large is precisely the mistake the API turns into `u64::MAX`.
   * The sum is compared at the API's own precision, like
   * `accountsForItsTotal`: each part can sit below the total while the pair
   * still exceeds it, and a truncated comparison could mask a real excess.
   */
  isPlausible: boolean
}

/**
 * Parses one `/positions` element at the vault's pinned share scale.
 * `undefined` when any of the three values is not a plain decimal — a value
 * that is present and unreadable is a failed read, not a zero balance.
 *
 * Every value is TRUNCATED to the share mint's own decimals on the way in.
 * The endpoint reports up to 14 decimal places for a 6-decimal mint, and the
 * extra digits are not a balance anyone can spend: handing the reported
 * string straight back as an amount asks for more than the position holds,
 * which the API rewrites to its withdraw-everything sentinel.
 */
export const parseKaminoSharePosition = ({
  position,
  shareDecimals,
}: {
  position: KaminoUserPositionResponse
  shareDecimals: number
}): KaminoSharePosition | undefined => {
  const staked = kaminoShareAmountFromDecimalString(position.stakedShares, shareDecimals)
  const unstaked = kaminoShareAmountFromDecimalString(position.unstakedShares, shareDecimals)
  const total = kaminoShareAmountFromDecimalString(position.totalShares, shareDecimals)
  const spendable = spendableShares(position.totalShares, shareDecimals)
  if (!staked || !unstaked || !total || !spendable) return undefined

  const reportedSum = sumKaminoRates(position.stakedShares, position.unstakedShares)
  const reportedTotal = parseKaminoRate(position.totalShares)

  return {
    staked,
    unstaked,
    total,
    spendable,
    accountsForItsTotal: reportedSum ? kaminoRateEquals(reportedSum, position.totalShares) : false,
    // The amounts above parsed, so the parts are non-negative; what remains to
    // check is that together they do not exceed the total.
    isPlausible:
      reportedSum !== undefined && reportedTotal !== undefined && compareKaminoRates(reportedSum, reportedTotal) <= 0,
  }
}

/**
 * The spendable rule: truncate to the mint's scale, and give up one base unit
 * only when the truncation was exact (see `KaminoSharePosition.spendable`).
 * Refusing the sentinel is the point of the whole withdraw guard, so it is
 * never accepted to make a 100% withdraw work — the dust is the price of the
 * sentinel being indistinguishable, in the bytes, from an amount the user
 * never asked for.
 */
const spendableShares = (totalShares: string, shareDecimals: number): KaminoShareAmount | undefined => {
  const rate = parseKaminoRate(totalShares)
  if (!rate) return undefined
  const scaled = scaleKaminoRate({ rate, toDecimals: shareDecimals })
  if (!scaled) return undefined

  const baseUnits = scaled.isExact ? scaled.baseUnits - 1n : scaled.baseUnits
  return kaminoShareAmount(baseUnits < 0n ? 0n : baseUnits, shareDecimals)
}
