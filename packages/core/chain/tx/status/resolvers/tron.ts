import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { TxStatusResolver } from '../resolver'

type TronTxInfoResponse = {
  id?: string
  fee?: number
  blockNumber?: number
  receipt?: {
    result?: string
  }
}

export const getTronTxStatus: TxStatusResolver<OtherChain.Tron> = async ({ hash }) => {
  const url = `${tronRpcUrl}/wallet/gettransactioninfobyid`

  const { data: tx, error } = await attempt(
    queryUrl<TronTxInfoResponse>(url, {
      body: { value: hash },
    })
  )

  if (error || !tx || tx.blockNumber === undefined || tx.blockNumber === 0) {
    return { status: 'pending' }
  }

  // iOS semantics:
  // - receipt absent → pending (mined but no receipt object yet)
  // - receipt.result present (any value: FAILED, OUT_OF_ENERGY, REVERT, …) → error
  // - receipt present, result absent → success
  if (!tx.receipt) {
    return { status: 'pending' }
  }

  const status = tx.receipt.result ? 'error' : 'success'
  const feeCoin = chainFeeCoin[Chain.Tron]
  const receipt =
    tx.fee != null
      ? {
          feeAmount: BigInt(tx.fee),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  return { status, receipt }
}
