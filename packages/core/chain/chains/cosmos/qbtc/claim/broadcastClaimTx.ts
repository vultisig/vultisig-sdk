import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { sleep } from '@vultisig/lib-utils/sleep'

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
  /**
   * Max time to wait for the tx to be included in a block after a
   * successful broadcast. Defaults to 30 s — Cosmos block times are
   * typically 5–7 s.
   */
  inclusionTimeoutMs?: number
  /** Polling interval while waiting for inclusion. Defaults to 1 s. */
  inclusionPollIntervalMs?: number
}

type EventAttribute = {
  key: string
  value?: string
}

type TxEvent = {
  type: string
  attributes?: EventAttribute[]
}

type TxResponse = {
  code?: number
  txhash?: string
  raw_log?: string
  log?: string
  events?: TxEvent[]
}

type BroadcastResponseShape = {
  tx_response?: TxResponse
}

type FetchTxResponseShape = {
  tx_response?: TxResponse
}

const claimWithProofEventType = 'claim_with_proof'

const findEventAttr = (
  events: TxEvent[] | undefined,
  type: string,
  key: string
): string | undefined =>
  events
    ?.find(e => e.type === type)
    ?.attributes?.find(a => a.key === key)?.value

const parseClaimResultFromEvents = (
  events: TxEvent[] | undefined,
  txHash: string
): ClaimTxResponse => ({
  totalAmountClaimed: BigInt(
    findEventAttr(events, claimWithProofEventType, 'total_amount') ?? '0'
  ),
  utxosClaimed: Number(
    findEventAttr(events, claimWithProofEventType, 'utxos_claimed') ?? '0'
  ),
  utxosSkipped: Number(
    findEventAttr(events, claimWithProofEventType, 'utxos_skipped') ?? '0'
  ),
  txHash,
})

const idempotentResult = (txHash: string): ClaimTxResponse => ({
  totalAmountClaimed: 0n,
  utxosClaimed: 0,
  utxosSkipped: 0,
  txHash,
})

/**
 * Polls `/cosmos/tx/v1beta1/txs/{txHash}` until the tx is included in a
 * block (200 OK) or the timeout fires. 404 means "not yet included" and
 * triggers a retry. Other non-2xx statuses propagate as errors so we
 * don't mask infra failures as "still pending".
 */
const waitForTxInclusion = async ({
  txHash,
  timeoutMs,
  intervalMs,
}: {
  txHash: string
  timeoutMs: number
  intervalMs: number
}): Promise<TxResponse> => {
  const url = `${qbtcRestUrl}/cosmos/tx/v1beta1/txs/${txHash}`
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const response = await fetch(url)

    if (response.ok) {
      const data: FetchTxResponseShape = await response.json()
      if (data.tx_response) return data.tx_response
      throw new Error(
        `QBTC claim tx ${txHash}: missing tx_response on inclusion query`
      )
    }

    if (response.status !== 404) {
      const text = await response.text()
      throw new Error(
        `QBTC claim inclusion query failed (${response.status}): ${text}`
      )
    }

    await sleep(intervalMs)
  }

  throw new Error(
    `QBTC claim tx ${txHash} not included within ${timeoutMs}ms`
  )
}

type WaitForClaimTxResultInput = {
  /** Transaction hash (hex, upper-case) returned by the broadcaster. */
  txHash: string
  /** Max time to wait for inclusion. Defaults to 30 s. */
  inclusionTimeoutMs?: number
  /** Poll interval. Defaults to 1 s. */
  inclusionPollIntervalMs?: number
}

/**
 * Polls the chain for an already-broadcast claim tx (e.g. one submitted by
 * the proof service via `generateClaimProof({ broadcast: true })`) and parses
 * the `claim_with_proof` event into a {@link ClaimTxResponse}.
 *
 * Mirrors the wait-and-parse half of {@link broadcastClaimTx} so callers who
 * didn't broadcast the tx themselves can still show real claim amounts.
 */
export const waitForClaimTxResult = async ({
  txHash,
  inclusionTimeoutMs = 30_000,
  inclusionPollIntervalMs = 1_000,
}: WaitForClaimTxResultInput): Promise<ClaimTxResponse> => {
  const included = await waitForTxInclusion({
    txHash,
    timeoutMs: inclusionTimeoutMs,
    intervalMs: inclusionPollIntervalMs,
  })

  if (typeof included.code !== 'number') {
    throw new Error(
      `QBTC claim tx ${txHash}: missing code on included tx_response`
    )
  }

  if (included.code !== 0) {
    const log = included.raw_log || included.log
    throw new Error(`QBTC claim tx error: ${log}`)
  }

  return parseClaimResultFromEvents(included.events, txHash)
}

/**
 * Broadcasts a signed MsgClaimWithProof transaction to the QBTC chain
 * via the REST API (following the restOnlyChains pattern).
 *
 * BROADCAST_MODE_SYNC returns after Tendermint's CheckTx — the
 * `claim_with_proof` event is emitted later in DeliverTx. We poll
 * `/cosmos/tx/v1beta1/txs/{txHash}` until the tx lands and parse the
 * event attributes (`total_amount`, `utxos_claimed`, `utxos_skipped`)
 * so the success screen can show real numbers instead of zeros.
 *
 * The claim transaction is gas-free — the chain does not charge gas.
 */
export const broadcastClaimTx = async ({
  txBytesBase64,
  txHash,
  inclusionTimeoutMs = 30_000,
  inclusionPollIntervalMs = 1_000,
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
    if (text.includes('tx already exists in cache')) {
      return idempotentResult(txHash)
    }
    throw new Error(`QBTC claim broadcast failed (${response.status}): ${text}`)
  }

  const data: BroadcastResponseShape = await response.json()

  if (typeof data.tx_response?.code !== 'number') {
    throw new Error('QBTC claim broadcast failed: missing tx_response.code')
  }

  if (data.tx_response.code !== 0) {
    const log = data.tx_response.raw_log || data.tx_response.log
    if (log?.includes('tx already exists in cache')) {
      return idempotentResult(txHash)
    }
    throw new Error(`QBTC claim tx error: ${log}`)
  }

  // CheckTx passed; wait for DeliverTx events.
  const included = await waitForTxInclusion({
    txHash,
    timeoutMs: inclusionTimeoutMs,
    intervalMs: inclusionPollIntervalMs,
  })

  if (typeof included.code !== 'number') {
    throw new Error(
      `QBTC claim tx ${txHash}: missing code on included tx_response`
    )
  }

  if (included.code !== 0) {
    const log = included.raw_log || included.log
    throw new Error(`QBTC claim tx error: ${log}`)
  }

  return parseClaimResultFromEvents(included.events, txHash)
}
