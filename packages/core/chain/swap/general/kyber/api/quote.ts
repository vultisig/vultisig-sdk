import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { GeneralSwapQuote } from '../../GeneralSwapQuote'
import { KyberSwapEnabledChain } from '../chains'
import { KyberSwapBaseAffiliateConfig } from '../config'
import { getKyberSwapRoute } from './route'
import { getKyberSwapTx } from './tx'

type Input = Record<TransferDirection, AccountCoin<KyberSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
  kyberConfig?: KyberSwapBaseAffiliateConfig
}

export const getKyberSwapQuote = async ({
  from,
  to,
  amount,
  affiliateBps,
  kyberConfig,
}: Input): Promise<GeneralSwapQuote> => {
  const { routeSummary, routerAddress } = await getKyberSwapRoute({
    from,
    to,
    amount,
    affiliateBps,
    kyberConfig,
  })

  const tx = await attempt(
    getKyberSwapTx({
      from,
      to,
      routeSummary,
      routerAddress,
      amount,
      enableGasEstimation: true,
      affiliateBps,
      kyberConfig,
    })
  )

  if ('error' in tx) {
    const { error } = tx
    if (isInError(error, 'TransferHelper')) {
      return getKyberSwapTx({
        from,
        to,
        routeSummary,
        routerAddress,
        amount,
        enableGasEstimation: false,
        affiliateBps,
        kyberConfig,
      })
    }

    throw error
  }

  return tx.data
}
