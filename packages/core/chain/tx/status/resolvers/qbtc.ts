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

type QbtcLookup = { kind: 'found'; response: TxResponse } | { kind: 'not_found' }

const isQbtcNotFoundResponse = (status: number, body: unknown): boolean => {
  if (status !== 404 || !body || typeof body !== 'object') return false

  const { code, message } = body as { code?: unknown; message?: unknown }
  return code === 5 && typeof message === 'string' && message.includes('tx not found')
}

export const getQbtcTxStatus: TxStatusResolver<typeof Chain.QBTC> = async ({ hash }) => {
  const url = `${qbtcRestUrl}/cosmos/tx/v1beta1/txs/${hash}`
  const { data: lookup, error } = await attempt(async (): Promise<QbtcLookup> => {
    const resp = await fetch(url)
    const body: unknown = await resp.json()
    if (isQbtcNotFoundResponse(resp.status, body)) return { kind: 'not_found' }
    if (!resp.ok) throw new Error(`${resp.status}`)
    return { kind: 'found', response: body as TxResponse }
  })

  if (lookup?.kind === 'not_found') {
    // The Cosmos LCD reserves code 5 / HTTP 404 for an absent transaction hash.
    return { status: 'not_found', isKnown: false }
  }

  const data = lookup?.kind === 'found' ? lookup.response : undefined
  if (error || !data?.tx_response) {
    return { status: 'pending', isKnown: false }
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
