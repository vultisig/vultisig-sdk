import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { CoinKey } from '@vultisig/core-chain/coin/Coin'

import { assertKnownToken } from '../knownTokens/utils'

export const makeAccountCoin = <C extends Chain>(
  key: Required<Pick<CoinKey<C>, 'chain' | 'id'>>,
  address: string
): AccountCoin => ({
  ...assertKnownToken(key),
  address,
})
