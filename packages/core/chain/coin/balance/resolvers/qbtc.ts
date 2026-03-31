import { StargateClient } from '@cosmjs/stargate'
import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcTendermintRpcUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { CoinBalanceResolver } from '../resolver'

const nativeQbtcDenom = 'qbtc'

export const getQbtcCoinBalance: CoinBalanceResolver<
  typeof Chain.QBTC
> = async input => {
  const client = await StargateClient.connect(qbtcTendermintRpcUrl)
  const denom = isFeeCoin(input) ? nativeQbtcDenom : shouldBePresent(input.id)
  const balance = await client.getBalance(input.address, denom)
  return BigInt(balance.amount)
}
