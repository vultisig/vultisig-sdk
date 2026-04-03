import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CoinBalanceResolver } from '../resolver'

const nativeQbtcDenom = 'qbtc'

export const getQbtcCoinBalance: CoinBalanceResolver<
  typeof Chain.QBTC
> = async input => {
  const denom = isFeeCoin(input) ? nativeQbtcDenom : shouldBePresent(input.id)
  const url = `${qbtcRestUrl}/cosmos/bank/v1beta1/balances/${input.address}`
  const data = await queryUrl<{
    balances: Array<{ denom: string; amount: string }>
  }>(url)
  const entry = data.balances.find(b => b.denom === denom)
  return entry ? BigInt(entry.amount) : 0n
}
