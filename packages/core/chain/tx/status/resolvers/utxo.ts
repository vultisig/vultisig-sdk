import { UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getBlockchairBaseUrl } from '../../../chains/utxo/client/getBlockchairBaseUrl'
import { TxStatusResolver } from '../resolver'

type BlockchairTxResponse = {
  data: Record<
    string,
    {
      transaction: {
        block_id: number | null
        fee?: number
      }
    }
  >
}

export const getUtxoTxStatus: TxStatusResolver<UtxoBasedChain> = async ({ chain, hash }) => {
  const baseUrl = getBlockchairBaseUrl(chain)
  const url = `${baseUrl}/dashboards/transaction/${hash}`

  const { data: response, error } = await attempt(queryUrl<BlockchairTxResponse>(url))

  if (error || !response || !response.data[hash]) {
    // Transient RPC/network failure OR Blockchair affirmatively has no record of this
    // hash at all — either way we can't confirm the tx is genuinely known. isKnown:false
    // so verifyBroadcastByHash's safety net does NOT swallow a real broadcast failure as
    // success (mirrors the isKnown convention every other chain resolver already uses —
    // cosmos.ts/evm.ts/polkadot.ts/ripple.ts/solana.ts). Before this, a genuinely-failed
    // broadcast (e.g. BadInputsUTxO, tx never reached the network) and a real in-flight
    // tx were indistinguishable here — both returned bare `{status:'pending'}`, which
    // verifyBroadcastByHash's `isKnown !== false` check treated as a confirmed positive.
    return { status: 'pending', isKnown: false }
  }

  const tx = response.data[hash].transaction

  if (tx.block_id === null || tx.block_id === -1) {
    // Blockchair HAS indexed this hash (mempool, not yet mined) — a real positive signal
    // the tx exists, unlike the "not found at all" branch above.
    return { status: 'pending', isKnown: true }
  }

  const feeCoin = chainFeeCoin[chain]
  const receipt =
    tx.fee != null && tx.fee >= 0
      ? {
          feeAmount: BigInt(tx.fee),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  return { status: 'success', receipt }
}
