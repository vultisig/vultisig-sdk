import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronGridUrl, tronPublicRpcUrl, tronRpcUrl } from './config'

type Options = { body?: unknown; headers?: Record<string, string>; timeoutMs?: number }
type Route = { primaryUrl?: string; fallbackUrl?: string }
type BroadcastResponse = { txid?: string; result?: boolean; code?: string; message?: string }

class TronAvailabilityError extends Error {}

export const isRetryableTronError = (error: unknown) =>
  error instanceof HttpResponseError
    ? error.status === 408 || error.status === 429 || error.status >= 500
    : error instanceof TypeError || error instanceof SyntaxError || error instanceof TronAvailabilityError

const fallbackFor = (path: string) =>
  path === '/jsonrpc' || path === '/wallet/triggerconstantcontract' || path === '/wallet/getchainparameters'
    ? tronGridUrl
    : tronPublicRpcUrl

const restResponseFields: Record<string, readonly string[]> = {
  '/wallet/getaccount': ['address', 'balance', 'account_name', 'frozenV2', 'unfrozenV2', 'result'],
  '/wallet/getaccountresource': [
    'freeNetUsed',
    'freeNetLimit',
    'NetUsed',
    'NetLimit',
    'EnergyUsed',
    'EnergyLimit',
    'TotalNetLimit',
    'TotalNetWeight',
    'TotalEnergyLimit',
    'TotalEnergyWeight',
    'assetNetUsed',
    'assetNetLimit',
  ],
  '/wallet/gettransactionbyid': ['txID'],
  '/wallet/gettransactioninfobyid': ['id'],
}

async function request<T>(endpoint: string, path: string, options: Options): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const data = await queryUrl<Record<string, unknown>>(`${endpoint.replace(/\/$/, '')}${path}`, {
      ...options,
      signal: controller.signal,
    })
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TronAvailabilityError(`Tron ${path} returned a malformed response`)
    }
    // Node/contract errors are semantic responses, including HTTP-200 errors.
    // Never retry them as outages or allow account readers to turn them into zero.
    if (data.Error || data.error) {
      throw new Error(`Tron ${path} rejected request: ${JSON.stringify(data.Error ?? data.error)}`)
    }
    const fields = restResponseFields[path]
    if (
      fields &&
      (data.code ||
        data.result === false ||
        (typeof data.result === 'object' &&
          data.result !== null &&
          'result' in data.result &&
          data.result.result === false))
    ) {
      throw new Error(`Tron ${path} rejected request: ${JSON.stringify(data)}`)
    }
    // Protobuf JSON legitimately uses {} for absent accounts/transactions.
    // Nonempty gateway error pages must not become a zero balance or not_found.
    if (fields && Object.keys(data).length && !fields.some(field => field in data)) {
      throw new TronAvailabilityError(`Tron ${path} returned an unrecognized response`)
    }
    if (path === '/jsonrpc' && !('result' in data)) {
      throw new TronAvailabilityError('Tron JSON-RPC response has no result')
    }
    if ((path === '/wallet/getnowblock' || path === '/wallet/getblockbynum') && !data.block_header) {
      throw new TronAvailabilityError('Tron block response has no header')
    }
    if (path === '/wallet/getchainparameters' && !Array.isArray(data.chainParameter)) {
      throw new TronAvailabilityError('Tron response has no chain parameters')
    }
    if (path === '/wallet/triggerconstantcontract' && !data.result && !data.constant_result) {
      throw new TronAvailabilityError('Tron contract response is malformed')
    }
    return data as T
  } catch (error) {
    if (controller.signal.aborted) throw new TronAvailabilityError(`Tron ${path} request timed out`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Default read routing. An explicit primary is used alone unless a fallback is also supplied. */
export async function queryTron<T>(path: string, options: Options = {}, route: Route = {}): Promise<T> {
  // Submission must go through the hash-verifying broadcaster below.
  if (path === '/wallet/broadcasttransaction') throw new Error('Use broadcastTronTransaction for submissions')
  const primary = route.primaryUrl ?? tronRpcUrl
  const fallback = route.fallbackUrl ?? (route.primaryUrl ? undefined : fallbackFor(path))
  try {
    return await request<T>(primary, path, options)
  } catch (error) {
    if (!fallback || !isRetryableTronError(error)) throw error
    return request<T>(fallback, path, options)
  }
}

/** Replays identical signed bytes only after a public-node hash lookup confirms absence. */
export async function broadcastTronTransaction(body: unknown, hash?: string): Promise<BroadcastResponse> {
  try {
    return await request<BroadcastResponse>(tronRpcUrl, '/wallet/broadcasttransaction', { body })
  } catch (error) {
    if (!isRetryableTronError(error) || !hash || !/^[a-f\d]{64}$/i.test(hash)) throw error
    for (const endpoint of [tronRpcUrl, tronPublicRpcUrl]) {
      let tx: { txID?: string }
      try {
        tx = await request(endpoint, '/wallet/gettransactionbyid', { body: { value: hash } })
      } catch (lookupError) {
        if (endpoint === tronRpcUrl && isRetryableTronError(lookupError)) continue
        throw lookupError
      }
      // Presence stops replay but is not success: callers must retain their
      // status-aware duplicate verification, including failed/expired outcomes.
      if (tx.txID?.toLowerCase() === hash.toLowerCase()) return { result: false, code: 'DUP_TRANSACTION_ERROR' }
      if (Object.keys(tx).length) throw error
    }
    return request<BroadcastResponse>(tronPublicRpcUrl, '/wallet/broadcasttransaction', { body })
  }
}
