import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

const taostatsExtrinsicUrl = `${rootApiUrl}/tao-tx/v1`

type TaostatsExtrinsicResponse = {
  pagination: { page: number; limit: number; total: number }
  data: Array<{
    hash: string
    block_number: number
    success: boolean
    fee?: string
    timestamp: string
  }>
}

export const getBittensorTxStatus: TxStatusResolver<
  OtherChain.Bittensor
> = async ({ hash }) => {
  const txHash = ensureHexPrefix(hash)

  const { data: response, error } = await attempt(
    queryUrl<TaostatsExtrinsicResponse>(
      `${taostatsExtrinsicUrl}?${new URLSearchParams({ hash: txHash })}`
    )
  )

  if (error || !response?.data?.length) {
    return { status: 'pending' }
  }

  const extrinsic = response.data[0]
  const feeCoin = chainFeeCoin[Chain.Bittensor]
  let receipt:
    | { feeAmount: bigint; feeDecimals: number; feeTicker: string }
    | undefined
  if (extrinsic.fee) {
    try {
      receipt = {
        feeAmount: BigInt(extrinsic.fee),
        feeDecimals: feeCoin.decimals,
        feeTicker: feeCoin.ticker,
      }
    } catch {
      // If fee string is not a valid integer, skip fee info rather than crash
      receipt = undefined
    }
  }

  return {
    status: extrinsic.success ? 'success' : 'error',
    receipt,
  }
}
