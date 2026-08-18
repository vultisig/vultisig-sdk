import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { kaminoConfig } from './config'
import { KaminoServiceError } from './KaminoServiceError'
import {
  KaminoPnlResponse,
  KaminoUserPositionResponse,
  KaminoVaultMetricsResponse,
  KaminoVaultStateResponse,
} from './models'

/**
 * Read-side REST client for Kamino Earn vaults, against
 * `https://api.kamino.finance` (public, unauthenticated).
 *
 * Kamino's structured error body is converted into `KaminoServiceError` so
 * callers can branch on `reason.api.code` (`KVAULT_NOT_FOUND`, …) instead of
 * matching message text. Retries are the caller's concern — the client layers
 * (react-query, CLI) already own retry policy, and `KaminoServiceError.isRetryable`
 * tells them whether one is worth it.
 */

/**
 * Timeout for the position read, which gates withdraws. Getting out of a
 * position is the operation whose failure a user cannot route around, so it
 * keeps a long limit: cutting the wait converts "slow" into "cannot withdraw"
 * rather than into a faster answer. Everything else uses `queryUrl`'s 20s
 * default, which no healthy Kamino call approaches (reads measure ~100ms).
 */
const positionsReadTimeoutMs = 60_000

/** Error body the API returns with a 400. */
type KaminoErrorResponse = {
  statusCode: number
  message: string
  error: string
  code?: string
}

const isKaminoErrorBody = (body: unknown): body is KaminoErrorResponse =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as KaminoErrorResponse).statusCode === 'number' &&
  typeof (body as KaminoErrorResponse).message === 'string'

const kaminoGet = async <T>(path: string, timeoutMs?: number): Promise<T> => {
  try {
    return await queryUrl<T>(`${kaminoConfig.apiBaseUrl}${path}`, timeoutMs === undefined ? undefined : { timeoutMs })
  } catch (error) {
    if (error instanceof HttpResponseError && isKaminoErrorBody(error.body)) {
      throw new KaminoServiceError({
        api: { status: error.status, code: error.body.code, message: error.body.message },
      })
    }
    throw error
  }
}

/** Fetches a vault's live state (`GET /kvaults/vaults/{address}`). */
export const fetchKaminoVaultState = (address: string): Promise<KaminoVaultStateResponse> =>
  kaminoGet(`/kvaults/vaults/${address}`)

/** Fetches a vault's metrics (`GET /kvaults/vaults/{address}/metrics`). */
export const fetchKaminoVaultMetrics = (address: string): Promise<KaminoVaultMetricsResponse> =>
  kaminoGet(`/kvaults/vaults/${address}/metrics`)

/**
 * Fetches every kVault position the owner holds
 * (`GET /kvaults/users/{owner}/positions`). Uncached and generously timed —
 * this read gates withdraws.
 */
export const fetchKaminoUserPositions = (owner: string): Promise<KaminoUserPositionResponse[]> =>
  kaminoGet(`/kvaults/users/${owner}/positions`, positionsReadTimeoutMs)

/**
 * Fetches lifetime PnL for one position
 * (`GET /kvaults/users/{owner}/vaults/{vault}/pnl`).
 */
export const fetchKaminoPnl = ({ owner, vault }: { owner: string; vault: string }): Promise<KaminoPnlResponse> =>
  kaminoGet(`/kvaults/users/${owner}/vaults/${vault}/pnl`)
