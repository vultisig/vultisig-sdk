/**
 * Minimal JSON fetch helper for the non-EVM balance reads in this folder.
 *
 * These chains (XRP / TON / TRON / Sui / Cardano / Bittensor) are not wired
 * through the EVM `getEvmClient` rail, so the balance tools talk to their
 * public RPC / API endpoints (and the Vultisig proxy at `api.vultisig.com`)
 * directly. This helper mirrors the retry + timeout behaviour the mcp-ts
 * `fetchJson` shipped, so the read semantics are unchanged as the code moves
 * into the SDK.
 *
 * Read-only: every function in this folder is a balance read. Nothing here
 * ever signs or broadcasts.
 */

import { withFetchTimeout } from '../../platforms/react-native/fetchWithTimeout'

/** Vultisig proxy root. Mirrors mcp-ts `ROOT_API_URL`. */
export const ROOT_API_URL = 'https://api.vultisig.com'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const DEFAULT_TIMEOUT_MS = 15_000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryable(error: unknown): boolean {
  // Network-level failures retry; deterministic timeouts do not (a retry just
  // stacks more multi-second waits past the caller's budget — worst case
  // MAX_RETRIES+1 full DEFAULT_TIMEOUT_MS waits before the caller sees
  // anything). Mirrors mcp-ts. FetchTimeoutError (sdk#1344 review) is
  // deliberately excluded for the same reason AbortSignal.timeout's
  // TimeoutError was never retried here — it's the flaky-mobile path where a
  // fail-fast timeout is the common, expected failure, not a one-off blip.
  if (error instanceof TypeError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return false
}

/**
 * Generic JSON fetch with retry + timeout. POSTs when `body` is provided,
 * GETs otherwise. Throws on 4xx (client error, no retry) and after exhausting
 * retries on 5xx / network failures.
 */
type FetchJsonResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; text: string }

export async function fetchJson<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // sdk#1344 review: withFetchTimeout clears its timer as soon as `consume`
      // settles, which used to be at HEADERS-arrived time (`consume = async
      // response => response`) — the body read below then ran with NO deadline
      // at all. The body read now happens INSIDE `consume`, so a server that
      // sends 200 + headers then stalls mid-body is still bounded by
      // DEFAULT_TIMEOUT_MS.
      const result = await withFetchTimeout<FetchJsonResult<T>>(
        url,
        {
          method: body ? 'POST' : 'GET',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          ...init,
        },
        DEFAULT_TIMEOUT_MS,
        async response => {
          if (response.ok) {
            return { ok: true, status: response.status, data: (await response.json()) as T }
          }
          return { ok: false, status: response.status, text: await response.text() }
        }
      )

      if (result.ok) {
        return result.data
      }

      // 429 — rate limited; back off and retry while attempts remain.
      if (result.status === 429 && attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }

      // Other 4xx — client error, don't retry.
      if (result.status >= 400 && result.status < 500) {
        throw new Error(`HTTP ${result.status}: ${result.text}`)
      }

      // 5xx — retry while attempts remain.
      if (attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }

      throw new Error(`HTTP ${result.status} after ${MAX_RETRIES + 1} attempts`)
    } catch (error) {
      if (isRetryable(error) && attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }
      throw error
    }
  }
  throw new Error('unreachable')
}

/**
 * Format a base-unit integer into a human-readable decimal string, trimming
 * trailing zeros. e.g. `formatBalance(1500000n, 6)` => `"1.5"`.
 */
export function formatBalance(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}
