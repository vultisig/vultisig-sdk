import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { minUtxo } from '../minUtxo'
import { Chain } from '@vultisig/core-chain/Chain'
import type { ChainPlainUtxo } from '../tx/ChainPlainUtxo'

type DashAddressUtxo = {
  address: string
  txid: string
  outputIndex: number
  script: string
  satoshis: number
  height: number
}

type DashRpcResponse = {
  result: DashAddressUtxo[] | null
  error: { code: number; message: string } | null
  id: string
}

export const getDashUtxos = async (
  address: string
): Promise<ChainPlainUtxo[]> => {
  const response = await queryUrl<DashRpcResponse>(`${rootApiUrl}/dash/`, {
    body: {
      jsonrpc: '1.0',
      id: 'vultisig',
      method: 'getaddressutxos',
      params: [{ addresses: [address] }],
    },
  })

  if (response.error) {
    throw new Error(`Dash RPC error: ${response.error.message}`)
  }

  if (!response.result) {
    return []
  }

  return response.result
    .filter(({ satoshis }) => satoshis > Number(minUtxo[Chain.Dash]))
    .map(({ txid, satoshis, outputIndex }) => ({
      hash: txid,
      amount: BigInt(satoshis),
      index: outputIndex,
    }))
}
