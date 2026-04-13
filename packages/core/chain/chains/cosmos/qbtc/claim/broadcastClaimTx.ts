import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'

type ClaimTxResponse = {
  /** Total satoshis claimed. */
  totalAmountClaimed: bigint
  /** Number of UTXOs successfully claimed. */
  utxosClaimed: number
  /** Number of UTXOs skipped (already claimed or address mismatch). */
  utxosSkipped: number
  /** Transaction hash. */
  txHash: string
}

type BroadcastClaimTxInput = {
  /** Base64-encoded TxRaw protobuf bytes. */
  txBytesBase64: string
  /** Transaction hash (SHA256 of TxRaw), hex-encoded. */
  txHash: string
}

type BroadcastResponse = {
  tx_response?: {
    code?: number
    txhash?: string
    raw_log?: string
    log?: string
  }
}

/**
 * Broadcasts a signed MsgClaimWithProof transaction to the QBTC chain
 * via the REST API (following the restOnlyChains pattern).
 *
 * The claim transaction is gas-free — the chain does not charge gas.
 */
export const broadcastClaimTx = async ({
  txBytesBase64,
  txHash,
}: BroadcastClaimTxInput): Promise<ClaimTxResponse> => {
  const response = await fetch(`${qbtcRestUrl}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: txBytesBase64,
      mode: 'BROADCAST_MODE_SYNC',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`QBTC claim broadcast failed (${response.status}): ${text}`)
  }

  const data: BroadcastResponse = await response.json()

  if (data.tx_response?.code && data.tx_response.code !== 0) {
    throw new Error(
      `QBTC claim tx error: ${data.tx_response.raw_log || data.tx_response.log}`
    )
  }

  return {
    totalAmountClaimed: 0n,
    utxosClaimed: 0,
    utxosSkipped: 0,
    txHash,
  }
}
