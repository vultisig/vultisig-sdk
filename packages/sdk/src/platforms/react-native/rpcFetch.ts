/**
 * Fetch-based JSON-RPC client for React Native consumers.
 *
 * RN has no `net`/`tls`/`http`/`ws` — this avoids every stock RPC client
 * that static-imports those built-ins. Use this for EVM/Sui/Tron/Ripple
 * REST endpoints where the callsite controls the URL and payload shape.
 */

export type JsonRpcParams = unknown[] | Record<string, unknown>

export type JsonRpcResponse<T> = {
  jsonrpc: '2.0'
  id: number | string
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcCallOptions = {
  id?: number | string
  signal?: AbortSignal
  headers?: Record<string, string>
}

export class JsonRpcError extends Error {
  readonly code: number
  readonly data: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(`JSON-RPC error ${code}: ${message}`)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

/**
 * POST a JSON-RPC request and unwrap `result`. Throws `JsonRpcError` on
 * `{error: {...}}` payloads and `Error` on HTTP-level failures.
 */
export async function jsonRpcCall<T = unknown>(
  url: string,
  method: string,
  params: JsonRpcParams = [],
  options: JsonRpcCallOptions = {}
): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: options.id ?? 1,
    method,
    params,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body,
    signal: options.signal,
  })
  if (!res.ok) {
    throw new Error(`JSON-RPC HTTP ${res.status} ${res.statusText} from ${url}`)
  }
  const payload = (await res.json()) as JsonRpcResponse<T>
  if (payload.error) {
    throw new JsonRpcError(payload.error.code, payload.error.message, payload.error.data)
  }
  if (payload.result === undefined) {
    throw new Error(`JSON-RPC response missing result: ${JSON.stringify(payload)}`)
  }
  return payload.result
}

/**
 * Thin wrapper around `fetch` that parses JSON and throws on HTTP failure.
 * Useful for REST RPC endpoints (Ripple, Tron, Cosmos LCD, etc.) where the
 * endpoint isn't JSON-RPC but still returns JSON.
 */
export async function queryUrl<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const preview = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${preview.slice(0, 200)}`)
  }
  return (await res.json()) as T
}
