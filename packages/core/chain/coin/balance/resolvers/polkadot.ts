import '@polkadot/api-augment'

import { getPolkadotClient } from '@core/chain/chains/polkadot/client'

import { CoinBalanceResolver } from '../resolver'

export const getPolkadotCoinBalance: CoinBalanceResolver = async input => {
  const client = await getPolkadotClient()
  const { data } = await client.query.system.account(input.address)

  return data.free.toBigInt()
}
