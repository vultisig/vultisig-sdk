import { getRippleAccountInfo } from '@vultisig/core-chain/chains/ripple/account/info'
import { getRippleAccountLines } from '@vultisig/core-chain/chains/ripple/account/lines'
import {
  parseIssuedCurrencyValue,
  parseRippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { getRippleNetworkInfo } from '@vultisig/core-chain/chains/ripple/network/info'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { CoinBalanceResolver } from '../resolver'

/**
 * Balance of a single XRPL issued currency (trust-line token), in base units at
 * `rippleIssuedCurrencyDecimals`.
 *
 * A line with a negative balance means this account is the token's issuer and owes
 * the counterparty, so it is not a holding — it is reported as zero rather than as
 * a negative asset. An account with no line for the token has a zero balance too.
 */
const getRippleIssuedCurrencyBalance = async ({ address, id }: { address: string; id: string }): Promise<bigint> => {
  const { currency, issuer } = parseRippleTokenId(id)

  const linesResult = await attempt(getRippleAccountLines(address))

  if ('error' in linesResult) {
    // An unfunded account holds no trust lines — it is not an error state.
    if (isInError(linesResult.error, 'Account not found', 'actNotFound')) {
      return BigInt(0)
    }

    throw linesResult.error
  }

  const line = linesResult.data.find(
    ({ account, currency: lineCurrency }) =>
      account === issuer && toXrplCurrencyCode(lineCurrency) === toXrplCurrencyCode(currency)
  )

  if (!line) {
    return BigInt(0)
  }

  const balance = parseIssuedCurrencyValue(line.balance)

  return balance > 0 ? balance : BigInt(0)
}

/** Spendable native XRP: total balance minus the base and owner reserves. */
const getRippleNativeBalance = async (address: string): Promise<bigint> => {
  const [accountResult, networkResult] = await Promise.all([
    attempt(getRippleAccountInfo(address)),
    attempt(getRippleNetworkInfo()),
  ])

  if ('error' in accountResult) {
    if (isInError(accountResult.error, 'Account not found')) {
      return BigInt(0)
    }

    throw accountResult.error
  }

  if ('error' in networkResult) {
    throw networkResult.error
  }

  const { account_data } = accountResult.data
  const { validated_ledger } = networkResult.data

  if (!validated_ledger) {
    throw new Error('No validated ledger available')
  }

  const totalBalance = BigInt(account_data.Balance)
  const { reserve_base, reserve_inc } = shouldBePresent(validated_ledger)

  // `OwnerCount` already counts every owned ledger object, trust lines included,
  // so the trust-line count must not be added again here.
  const totalReserve = BigInt(reserve_base) + BigInt(account_data.OwnerCount) * BigInt(reserve_inc)
  const spendableBalance = totalBalance - totalReserve

  return spendableBalance > 0 ? spendableBalance : BigInt(0)
}

export const getRippleCoinBalance: CoinBalanceResolver = async input =>
  isFeeCoin(input)
    ? getRippleNativeBalance(input.address)
    : getRippleIssuedCurrencyBalance({
        address: input.address,
        id: shouldBePresent(input.id, 'Ripple token id'),
      })
