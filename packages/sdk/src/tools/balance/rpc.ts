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
  // stacks more multi-second waits past the caller's budget). Mirrors mcp-ts.
  if (error instanceof TypeError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return false
}

/**
 * Generic JSON fetch with retry + timeout. POSTs when `body` is provided,
 * GETs otherwise. Throws on 4xx (client error, no retry) and after exhausting
 * retries on 5xx / network failures.
 */
export async function fetchJson<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        ...init,
      })

      if (response.ok) {
        return response.json() as Promise<T>
      }

      // 429 — rate limited; back off and retry while attempts remain.
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }

      // Other 4xx — client error, don't retry.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      // 5xx — retry while attempts remain.
      if (attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }

      throw new Error(`HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`)
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
