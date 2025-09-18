import { Chain } from '../../Chain'
import { AccountCoin } from '../AccountCoin'
import { CoinKey } from '../Coin'

import { assertKnownToken } from '../knownTokens/utils'

export const makeAccountCoin = <C extends Chain>(
  key: Required<Pick<CoinKey<C>, 'chain' | 'id'>>,
  address: string
): AccountCoin => ({
  ...assertKnownToken(key),
  address,
})
