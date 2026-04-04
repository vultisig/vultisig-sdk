import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

type TxResponse = {
  tx?: {
    auth_info?: {
      fee?: {
        amount?: Array<{ denom: string; amount: string }>
      }
    }
  }
  tx_response: {
    code: number
    txhash: string
    gas_used: string
    gas_wanted: string
  }
}

export const getQbtcTxStatus: TxStatusResolver<typeof Chain.QBTC> = async ({
  hash,
}) => {
  const url = `${qbtcRestUrl}/cosmos/tx/v1beta1/txs/${hash}`
  const { data, error } = await attempt(async () => {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`${resp.status}`)
    return resp.json() as Promise<TxResponse>
  })

  if (error || !data?.tx_response) {
    return { status: 'pending' }
  }

  const txResp = data.tx_response
  const status = txResp.code === 0 ? 'success' : 'error'
  const feeCoin = chainFeeCoin[Chain.QBTC]

  const receipt = (() => {
    const gasUsed = BigInt(txResp.gas_used || '0')
    const gasWanted = BigInt(txResp.gas_wanted || '0')
    if (gasUsed === 0n || gasWanted === 0n) return undefined
    const maxFeeAmount = data.tx?.auth_info?.fee?.amount?.[0]?.amount
    if (!maxFeeAmount) return undefined
    const actualFee = (BigInt(maxFeeAmount) * gasUsed) / gasWanted
    if (actualFee === 0n) return undefined
    return {
      feeAmount: actualFee,
      feeDecimals: feeCoin.decimals,
      feeTicker: feeCoin.ticker,
    }
  })()

  return { status, receipt }
}
