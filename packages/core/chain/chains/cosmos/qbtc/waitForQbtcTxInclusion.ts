import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { sleep } from '@vultisig/lib-utils/sleep'

export type QbtcTxEventAttribute = {
  key: string
  value?: string
}

export type QbtcTxEvent = {
  type: string
  attributes?: QbtcTxEventAttribute[]
}

export type QbtcTxResponse = {
  code?: number
  txhash?: string
  raw_log?: string
  log?: string
  events?: QbtcTxEvent[]
}

type FetchTxResponseShape = {
  tx_response?: QbtcTxResponse
}

/**
 * Polls `/cosmos/tx/v1beta1/txs/{txHash}` until the tx is included in a block (200 OK) or the
 * timeout fires. 404 means "not yet included" and triggers a retry. Other non-2xx statuses
 * propagate as errors so we don't mask infra failures as "still pending".
 *
 * QBTC broadcasts use `BROADCAST_MODE_SYNC`, which only surfaces the CheckTx (mempool-admission)
 * code — a DeliverTx failure (out-of-gas, execution revert) still returns `code: 0` at broadcast
 * time. Both the claim helper (broadcastClaimTx) and the send broadcast resolver
 * (tx/broadcast/resolvers/qbtc) poll here and re-check the included `code` so an execution failure
 * isn't reported as a successful broadcast.
 */
export const waitForQbtcTxInclusion = async ({
  txHash,
  timeoutMs,
  intervalMs,
}: {
  txHash: string
  timeoutMs: number
  intervalMs: number
}): Promise<QbtcTxResponse> => {
  const url = `${qbtcRestUrl}/cosmos/tx/v1beta1/txs/${txHash}`
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const response = await fetch(url)

    if (response.ok) {
      const data: FetchTxResponseShape = await response.json()
      if (data.tx_response) return data.tx_response
      throw new Error(`QBTC tx ${txHash}: missing tx_response on inclusion query`)
    }

    if (response.status !== 404) {
      const text = await response.text()
      throw new Error(`QBTC inclusion query failed (${response.status}): ${text}`)
    }

    await sleep(intervalMs)
  }

  throw new Error(`QBTC tx ${txHash} not included within ${timeoutMs}ms`)
}
