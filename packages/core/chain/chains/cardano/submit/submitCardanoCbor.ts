import { rootApiUrl } from '@vultisig/core-config'
import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'
import { attempt } from '@vultisig/lib-utils/attempt'

/** Ogmios submit-transaction RPC shape — see https://ogmios.dev. */
type OgmiosResponse = {
  jsonrpc?: string
  result?: { transaction?: { id?: string } }
  error?: { code?: number; message?: string }
}

const cardanoBroadcastUrl = `${rootApiUrl}/ada/`

const stripHashPrefix = (hash: string): string => hash.replace(/^0x/i, '')

/** Low-level result so callers can branch on already-committed (3117) etc. */
export type SubmitCardanoCborResult = {
  txHash: string | null
  errorMessage: string | null
  /** JSON-RPC error code from the node, when present. */
  rpcErrorCode?: number
  /** Raw response body, for callers that want to log or pattern match. */
  rawResponse: string
}

/**
 * Broadcast a hex-encoded Cardano transaction CBOR via the Vultisig Ogmios JSON-RPC proxy.
 *
 * This low-level helper exposes the raw response so higher-level callers can
 * distinguish "already-committed" (`rpcErrorCode === 3117`), mempool conflicts,
 * etc. For the common "submit or throw" shape, use `submitCardanoCborTx`.
 */
export const submitCardanoCbor = async (
  cborHex: string
): Promise<SubmitCardanoCborResult> => {
  const cleaned = cborHex.replace(/^0x/i, '').toLowerCase()

  // Direct fetch: `queryUrl` auto-runs assertFetchResponse which throws before
  // we can inspect the raw body or status.
  const response = await fetch(cardanoBroadcastUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'submitTransaction',
      params: { transaction: { cbor: cleaned } },
      id: 1,
    }),
  })

  const rawResponse = await response.text()
  const parsedResult = attempt(() => JSON.parse(rawResponse) as OgmiosResponse)
  const parsed = 'data' in parsedResult ? parsedResult.data : null

  const txId = parsed?.result?.transaction?.id
  if (typeof txId === 'string' && txId.trim()) {
    return {
      txHash: stripHashPrefix(txId.trim()),
      errorMessage: null,
      rpcErrorCode: parsed?.error?.code,
      rawResponse,
    }
  }

  return {
    txHash: null,
    errorMessage: extractErrorMsg(parsed?.error ?? rawResponse),
    rpcErrorCode: parsed?.error?.code,
    rawResponse,
  }
}
