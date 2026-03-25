import { toChainAmount } from '@core/chain/amount/toChainAmount'
import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { CoinBalanceResolver } from '../resolver'

type PolkadotAccountBalance = {
  data: {
    account: {
      balance: number
    }
  }
}

export const getPolkadotCoinBalance: CoinBalanceResolver = async input => {
  const { data } = await queryUrl<PolkadotAccountBalance>(
    'https://assethub-polkadot.api.subscan.io/api/v2/scan/search',
    {
      headers: { 'X-API-Key': 'e3dd77cbcfb642aca70f1c7d539766ea' },
      body: { key: input.address },
    }
  )

  return toChainAmount(
    data.account.balance,
    chainFeeCoin[Chain.Polkadot].decimals
  )
}
