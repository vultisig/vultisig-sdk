import { getNearAccount } from '@vultisig/core-chain/chains/near/api'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { CoinBalanceResolver } from '../resolver'

/**
 * Native NEAR balance: the account's raw unlocked `amount`. The storage stake is
 * not subtracted (a balance that hides it is indistinguishable from a lost one)
 * and `locked` is never added; both enter MAX through `getNearSendLimits`.
 *
 * A missing account reads as zero; a broken or malformed read propagates, so an
 * RPC failure can never display as zero.
 */
export const getNearCoinBalance: CoinBalanceResolver = async input => {
  if (!isFeeCoin(input)) {
    throw new Error('NEAR NEP-141 token balances are not supported by this SDK')
  }

  const account = await getNearAccount(input.address)

  return account?.amount ?? 0n
}
