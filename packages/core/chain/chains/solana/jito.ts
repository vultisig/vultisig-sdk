import { PublicKey } from '@solana/web3.js'
import base58 from 'bs58'

const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf'

/** Fallback tip accounts if getTipAccounts RPC is unavailable */
const FALLBACK_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiCKDmpu',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLLWDMFf4t6U82o6QY',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]

/** Default tip when tip floor data is unavailable (10,000 lamports ≈ $0.002) */
const DEFAULT_TIP_LAMPORTS = 10_000

// ---------------------------------------------------------------------------
// Tip account cache (fetched via getTipAccounts RPC, 60s TTL)
// ---------------------------------------------------------------------------

let tipAccountsCache: { accounts: string[]; timestamp: number } | null = null
const TIP_ACCOUNTS_CACHE_TTL_MS = 60_000

/**
 * Fetch dynamic tip accounts from JITO Block Engine.
 * These can change — always prefer fetched values over hardcoded fallbacks.
 */
export async function fetchTipAccounts(): Promise<string[]> {
  if (
    tipAccountsCache &&
    Date.now() - tipAccountsCache.timestamp < TIP_ACCOUNTS_CACHE_TTL_MS
  ) {
    return tipAccountsCache.accounts
  }

  const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTipAccounts',
      params: [],
    }),
  })

  const data = await response.json()
  if (data.error || !data.result?.length) {
    throw new Error(
      `JITO getTipAccounts failed: ${JSON.stringify(data.error ?? 'empty result')}`
    )
  }

  tipAccountsCache = { accounts: data.result, timestamp: Date.now() }
  return data.result
}

/**
 * Get a random JITO tip account. Uses cached dynamic accounts if available,
 * falls back to hardcoded list. Call fetchTipAccounts() to warm the cache.
 */
export function getRandomTipAccount(): PublicKey {
  const accounts =
    tipAccountsCache &&
    Date.now() - tipAccountsCache.timestamp < TIP_ACCOUNTS_CACHE_TTL_MS
      ? tipAccountsCache.accounts
      : FALLBACK_TIP_ACCOUNTS
  const idx = Math.floor(Math.random() * accounts.length)
  return new PublicKey(accounts[idx])
}

// ---------------------------------------------------------------------------
// Tip floor cache (fetched via REST API, 10s TTL)
// ---------------------------------------------------------------------------

type TipFloorData = {
  landed_tips_25th_percentile: number
  landed_tips_50th_percentile: number
  landed_tips_75th_percentile: number
  landed_tips_95th_percentile: number
  landed_tips_99th_percentile: number
  ema_landed_tips_50th_percentile: number
}

let tipFloorCache: { data: TipFloorData; timestamp: number } | null = null
const TIP_FLOOR_CACHE_TTL_MS = 10_000

export async function getTipFloor(): Promise<TipFloorData> {
  if (
    tipFloorCache &&
    Date.now() - tipFloorCache.timestamp < TIP_FLOOR_CACHE_TTL_MS
  ) {
    return tipFloorCache.data
  }

  const response = await fetch(
    'https://bundles-api-rest.jito.wtf/api/v1/bundles/tip_floor'
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch JITO tip floor: ${response.status}`)
  }

  const result = await response.json()
  const data = Array.isArray(result) ? result[0] : result

  tipFloorCache = { data, timestamp: Date.now() }
  return data
}

/**
 * Get recommended tip in lamports. Uses cached tip floor if warm (EMA 50th
 * percentile), otherwise returns a conservative default. Synchronous — safe
 * to call from signing input resolvers. Warm the cache with getTipFloor().
 */
export function getRecommendedTipLamportsSync(): number {
  if (
    tipFloorCache &&
    Date.now() - tipFloorCache.timestamp < TIP_FLOOR_CACHE_TTL_MS
  ) {
    const tipSol = tipFloorCache.data.ema_landed_tips_50th_percentile
    return Math.max(Math.ceil(tipSol * 1_000_000_000), 1_000)
  }
  return DEFAULT_TIP_LAMPORTS
}

// ---------------------------------------------------------------------------
// Transaction submission
// ---------------------------------------------------------------------------

/**
 * Submit a single signed transaction via JITO's sendTransaction endpoint.
 * Provides free MEV protection (private mempool) without requiring a bundle or tip.
 */
export async function sendJitoTransaction(
  rawTransaction: Uint8Array
): Promise<string> {
  const encoded = base58.encode(rawTransaction)

  const response = await fetch(
    `${JITO_BLOCK_ENGINE_URL}/api/v1/transactions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [encoded, { encoding: 'base58' }],
      }),
    }
  )

  const data = await response.json()
  if (data.error) {
    throw new Error(
      `JITO sendTransaction failed: ${JSON.stringify(data.error)}`
    )
  }
  return data.result
}

/**
 * Submit a bundle of up to 5 signed transactions for atomic sequential execution.
 * All transactions must be fully signed. The tip instruction should be in the last tx.
 */
export async function sendBundle(
  signedTransactions: Uint8Array[]
): Promise<string> {
  const encoded = signedTransactions.map(tx => base58.encode(tx))

  const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [encoded],
    }),
  })

  const data = await response.json()
  if (data.error) {
    throw new Error(`JITO sendBundle failed: ${JSON.stringify(data.error)}`)
  }
  return data.result
}
