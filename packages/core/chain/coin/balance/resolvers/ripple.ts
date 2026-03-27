import { getRippleAccountInfo } from '@vultisig/core-chain/chains/ripple/account/info'
import { getRippleNetworkInfo } from '@vultisig/core-chain/chains/ripple/network/info'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { CoinBalanceResolver } from '../resolver'

export const getRippleCoinBalance: CoinBalanceResolver = async input => {
  const [accountResult, networkResult] = await Promise.all([
    attempt(getRippleAccountInfo(input.address)),
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

  const totalReserve =
    BigInt(reserve_base) + BigInt(account_data.OwnerCount) * BigInt(reserve_inc)
  const spendableBalance = totalBalance - totalReserve

  return spendableBalance > 0 ? spendableBalance : BigInt(0)
}
