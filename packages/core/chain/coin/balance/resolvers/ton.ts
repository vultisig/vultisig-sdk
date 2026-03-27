import { getTonAccountInfo } from '@vultisig/core-chain/chains/ton/account/getTonAccountInfo'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'

import { CoinBalanceResolver } from '../resolver'

export const getTonCoinBalance: CoinBalanceResolver = async input => {
  const { balance } = await getTonAccountInfo(input.address)

  return bigIntMax(BigInt(balance), BigInt(0))
}
