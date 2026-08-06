import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { CoinBalanceResolver } from '../resolver'

export const getSuiCoinBalance: CoinBalanceResolver = async input => {
  const client = getSuiClient()

  // The unified client nests the balance: `{ balance: { balance, coinType, ... } }`.
  // `balance.balance` is the total (the retired JSON-RPC `totalBalance`), NOT
  // the `coinBalance` / `addressBalance` split.
  const { balance } = await client.getBalance({
    owner: input.address,
    ...(input.id ? { coinType: input.id } : {}),
  })

  return BigInt(balance.balance)
}
