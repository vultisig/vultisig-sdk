import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { CoinBalanceResolver } from '../resolver'

export const getSuiCoinBalance: CoinBalanceResolver = async input => {
  const rpcClient = getSuiClient()

  const { totalBalance } = await rpcClient.getBalance({
    owner: input.address,
    ...(input.id ? { coinType: input.id } : {}),
  })

  return BigInt(totalBalance)
}
