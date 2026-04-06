import base58 from 'bs58'

const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf'
const JITO_HTTP_TIMEOUT_MS = 8_000

type JitoRpcResponse<T = unknown> = {
  result: T
  error?: { code: number; message: string }
}

async function jitoFetch<T = unknown>(url: string, body: unknown): Promise<JitoRpcResponse<T>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), JITO_HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`JITO request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Submit a single signed transaction via JITO's sendTransaction endpoint.
 * Provides free MEV protection (private mempool) without requiring a bundle or tip.
 */
export async function sendJitoTransaction(
  rawTransaction: Uint8Array
): Promise<string> {
  const encoded = base58.encode(rawTransaction)

  const data = await jitoFetch<string>(`${JITO_BLOCK_ENGINE_URL}/api/v1/transactions`, {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: [encoded, { encoding: 'base58' }],
  })
  if (data.error) {
    throw new Error(
      `JITO sendTransaction failed: ${JSON.stringify(data.error)}`
    )
  }
  return data.result
}
