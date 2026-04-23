/**
 * UTXO JSON-REST helpers (Blockstream/Electrs-style API).
 *
 * UTXO chains don't expose JSON-RPC the way EVM / Solana do — they use a
 * REST shape popularised by Blockstream.info + Mempool.space (now called
 * "Electrs API"). These helpers accept an explicit `apiUrl` so consumers pick
 * their own endpoint:
 *
 *   - Bitcoin:      https://blockstream.info/api  |  https://mempool.space/api
 *   - Litecoin:     https://litecoinspace.org/api
 *   - Dogecoin:     (no standard Electrs host — use Blockchair facade)
 *   - Dash:         https://electrs.dash.org/api  (community)
 *   - Bitcoin-Cash: https://blockchain.info/bch-api (or bch-chain.com)
 *   - Zcash:        limited Electrs availability — use Blockchair facade
 *
 * For Blockchair-compatible consumers (the shape vultiagent-app uses today),
 * point `apiUrl` at the proxied `${rootApiUrl}/blockchair/{chain}` base — see
 * `apiUrlKind: 'blockchair'` for the matching request shape.
 *
 * Chain-agnostic contract: every helper returns plain JSON-serialisable data.
 * Consumers handle retries, rate-limiting, and error classification.
 */

import type { UtxoChainName } from './tx'

export type UtxoApiKind = 'electrs' | 'blockchair'

export type UtxoApiOptions = {
  /** Full base URL for the chain-scoped API (no trailing slash). */
  apiUrl: string
  /**
   * Which API shape the endpoint exposes.
   *   - 'electrs'   → Blockstream/Electrs-style REST (default)
   *   - 'blockchair' → Blockchair API (used by VultiServer's proxy layer)
   */
  apiUrlKind?: UtxoApiKind
}

export type GetUtxosOptions = UtxoApiOptions & {
  chain: UtxoChainName
  address: string
}

export type PlainUtxo = {
  hash: string
  index: number
  value: bigint
}

const BLOCKCHAIR_CHAIN_SLUGS: Record<UtxoChainName, string> = {
  Bitcoin: 'bitcoin',
  Litecoin: 'litecoin',
  Dogecoin: 'dogecoin',
  'Bitcoin-Cash': 'bitcoin-cash',
  Dash: 'dash',
  Zcash: 'zcash',
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${url}: ${body.substring(0, 200)}`)
  }
  return (await res.json()) as T
}

/**
 * List unspent outputs for `address`. Works on both Electrs-style and
 * Blockchair-style backends.
 */
export async function getUtxos(opts: GetUtxosOptions): Promise<PlainUtxo[]> {
  const kind = opts.apiUrlKind ?? 'electrs'

  if (kind === 'electrs') {
    type ElectrsUtxo = {
      txid: string
      vout: number
      value: number
      status?: { confirmed: boolean; block_height?: number }
    }
    const utxos = await fetchJson<ElectrsUtxo[]>(`${opts.apiUrl}/address/${opts.address}/utxo`)
    return utxos.map(u => ({ hash: u.txid, index: u.vout, value: BigInt(u.value) }))
  }

  // blockchair
  const slug = BLOCKCHAIR_CHAIN_SLUGS[opts.chain]
  type BlockchairResp = {
    data: Record<string, { utxo: Array<{ transaction_hash: string; index: number; value: number }> }>
  }
  const resp = await fetchJson<BlockchairResp>(`${opts.apiUrl}/${slug}/dashboards/address/${opts.address}?limit=100`)
  const entry = resp.data[opts.address]
  if (!entry?.utxo) return []
  return entry.utxo.map(u => ({
    hash: u.transaction_hash,
    index: u.index,
    value: BigInt(u.value),
  }))
}

export type GetUtxoBalanceOptions = UtxoApiOptions & {
  chain: UtxoChainName
  address: string
}

/**
 * Get the confirmed balance for `address` in base units.
 */
export async function getUtxoBalance(opts: GetUtxoBalanceOptions): Promise<bigint> {
  const kind = opts.apiUrlKind ?? 'electrs'

  if (kind === 'electrs') {
    type ElectrsAddr = {
      chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
    }
    const info = await fetchJson<ElectrsAddr>(`${opts.apiUrl}/address/${opts.address}`)
    const confirmed = info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum
    return BigInt(confirmed)
  }

  const slug = BLOCKCHAIR_CHAIN_SLUGS[opts.chain]
  type BlockchairResp = {
    data: Record<string, { address: { balance: number } }>
  }
  const resp = await fetchJson<BlockchairResp>(`${opts.apiUrl}/${slug}/dashboards/address/${opts.address}?limit=0`)
  const entry = resp.data[opts.address]
  return BigInt(entry?.address?.balance ?? 0)
}

export type EstimateUtxoFeeOptions = UtxoApiOptions & {
  chain: UtxoChainName
}

/**
 * Get a suggested fee rate in sats/byte for the next-block target.
 *
 * For Zcash we clamp to 100 sats/byte to satisfy ZIP-317's 10,000 zat/tx
 * minimum on typical 150-250 byte txs (Blockchair reports ~1 sat/byte which
 * is below the network floor — see packages/core/chain/chains/utxo/fee/byteFee).
 */
export async function estimateUtxoFee(opts: EstimateUtxoFeeOptions): Promise<number> {
  if (opts.chain === 'Zcash') return 100

  const kind = opts.apiUrlKind ?? 'electrs'

  if (kind === 'electrs') {
    // Electrs returns a target-block -> fee-rate (sats/vbyte) map.
    const rates = await fetchJson<Record<string, number>>(`${opts.apiUrl}/fee-estimates`)
    const next = rates['1'] ?? rates['2'] ?? rates['6']
    if (next == null) throw new Error(`no fee estimate returned from ${opts.apiUrl}/fee-estimates`)
    return Math.max(1, Math.ceil(next))
  }

  const slug = BLOCKCHAIR_CHAIN_SLUGS[opts.chain]
  type BlockchairStats = {
    data: { suggested_transaction_fee_per_byte_sat?: number }
  }
  const resp = await fetchJson<BlockchairStats>(`${opts.apiUrl}/${slug}/stats`)
  const base = resp.data.suggested_transaction_fee_per_byte_sat ?? 1
  if (opts.chain === 'Dogecoin') {
    // Blockchair reports ~500,000 sats/byte for DOGE — 10x too high for our
    // use (matches the iOS impl's /10 workaround).
    return Math.max(1, Math.floor(base / 10))
  }
  // Electrs baseline + 25% buffer to match app behaviour.
  return Math.max(1, Math.ceil((base * 125) / 100))
}

export type BroadcastUtxoTxOptions = UtxoApiOptions & {
  chain: UtxoChainName
  rawTxHex: string
}

/**
 * Submit a pre-signed raw transaction. Returns the txid.
 */
export async function broadcastUtxoTx(opts: BroadcastUtxoTxOptions): Promise<string> {
  const kind = opts.apiUrlKind ?? 'electrs'

  if (kind === 'electrs') {
    const res = await fetch(`${opts.apiUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: opts.rawTxHex,
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`broadcast HTTP ${res.status}: ${body.substring(0, 200)}`)
    return body.trim()
  }

  // blockchair
  const slug = BLOCKCHAIR_CHAIN_SLUGS[opts.chain]
  type BlockchairBroadcast = {
    data?: { transaction_hash?: string } | null
    context?: { error?: string }
  }
  const resp = await fetchJson<BlockchairBroadcast>(`${opts.apiUrl}/${slug}/push/transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: opts.rawTxHex }),
  })
  if (resp.data?.transaction_hash) return resp.data.transaction_hash
  throw new Error(`broadcast failed: ${resp.context?.error ?? 'unknown error'}`)
}
