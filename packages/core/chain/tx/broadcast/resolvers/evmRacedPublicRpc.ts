import { EvmChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

/**
 * Public broadcast endpoints for chains where the Vultisig proxy routes
 * `eth_sendRawTransaction` through Blink Protect (or equivalent). Only
 * these URLs may win a raced broadcast — the proxy is never a winner.
 *
 * Sourced from public chainlist.org entries with no API key.
 */
export const evmRacedPublicBroadcastRpcs: Partial<Record<EvmChain, readonly string[]>> = {
  [EvmChain.Ethereum]: [
    'https://eth.llamarpc.com',
    'https://eth.merkle.io',
    'https://1rpc.io/eth',
    'https://rpc.ankr.com/eth',
    'https://eth.public-rpc.com',
  ],
}

const BROADCAST_TIMEOUT_MS = 8_000

const ALREADY_KNOWN_RE =
  /already known|same tx hash|transaction already exists|tx already in mempool|transaction already imported|\bknown transaction\b/i

type JsonRpcSendRawResponse = {
  result?: unknown
  error?: { message?: string }
}

export function hasEvmRacedPublicBroadcastRpcs(chain: EvmChain): boolean {
  return (evmRacedPublicBroadcastRpcs[chain]?.length ?? 0) > 0
}

async function sendRawTransaction(url: string, rawTxHex: string): Promise<void> {
  const body = await queryUrl<JsonRpcSendRawResponse>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [rawTxHex],
    },
    timeoutMs: BROADCAST_TIMEOUT_MS,
  })

  if (body?.error?.message) {
    throw new Error(body.error.message)
  }
  if (typeof body?.result !== 'string' || body.result.length === 0) {
    throw new Error('eth_sendRawTransaction returned no result')
  }
}

/**
 * Race `eth_sendRawTransaction` across the public endpoints for `chain`.
 * First success or already-known wins. The Vultisig proxy is never a
 * candidate — a Blink ack would report success on a tx that can still drop.
 *
 * Throws if the chain has no public endpoints configured, or if every
 * endpoint fails with something other than already-known.
 */
export async function broadcastEvmTxRacedPublicRpc(chain: EvmChain, rawTxHex: string): Promise<void> {
  const endpoints = evmRacedPublicBroadcastRpcs[chain]
  if (!endpoints?.length) {
    throw new Error(`raced-public-rpc broadcast is not configured for ${chain}`)
  }

  const errors: string[] = []
  const attempts = endpoints.map(async url => {
    try {
      await sendRawTransaction(url, rawTxHex)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (ALREADY_KNOWN_RE.test(message)) {
        return
      }
      errors.push(`${url}: ${message}`)
      throw error
    }
  })

  try {
    await Promise.any(attempts)
  } catch {
    throw new Error(`raced-public-rpc broadcast failed for ${chain}: ${errors.join('; ') || 'all endpoints rejected'}`)
  }
}
