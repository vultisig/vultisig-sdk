// StakeKit / yield.xyz HTTP client.
//
// This module is the SDK equivalent of mcp-ts/src/lib/yield-api.ts, adapted so:
//   - NO process.env anywhere — apiKey is injectable via every function param.
//   - ScanRequest types are inline (mcp-ts helpers live in a different package).
//   - Cache uses the same 5-minute TTL in-memory Map pattern as yield-api.ts.
//
// Ported from mcp-ts/src/lib/yield-api.ts.
// Builds UNSIGNED calldata only — never signs, never broadcasts.

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

// --- Module constants (NOT process.env) ---

const STAKEKIT_API_BASE = 'https://api.stakek.it/v1'
const STAKEKIT_MCP_URL = 'https://mcp.yield.xyz/mcp'

// --- Auth helper — apiKey is injectable ---

function authHeaders(apiKey?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (apiKey) headers['X-API-KEY'] = apiKey
  return headers
}

// --- Simple TTL cache (same pattern as defi-llama.ts) ---

const cache = new Map<string, { data: unknown; expires: number }>()

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache(key: string, data: unknown, ttlMs: number) {
  cache.set(key, { data, expires: Date.now() + ttlMs })
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// --- Types matching yield.xyz / stakek.it wire shapes ---

export type YieldToken = {
  symbol: string
  name: string
  network: string
  address?: string
  decimals: number
}

export type YieldMetadata = {
  name: string
  type: string
  provider?: { name: string }
  cooldownPeriod?: { days: number }
  warmupPeriod?: { days: number }
  rewardSchedule?: string
  rewardClaiming?: string
}

export type YieldArgs = {
  enter: { addresses: Record<string, unknown>; args: Record<string, unknown> }
  exit: { addresses: Record<string, unknown>; args: Record<string, unknown> }
}

export type Validator = {
  name: string
  address: string
  apr: number
  commission: number
  stakedBalance: string
  preferred: boolean
}

export type YieldProduct = {
  id: string
  token: YieldToken
  tokens: YieldToken[]
  apy: number
  isAvailable: boolean
  metadata: YieldMetadata
  args: YieldArgs
  validators: Validator[]
  status: { enter: boolean; exit: boolean }
  fee?: { enabled: boolean; percentage: number }
}

export type YieldListResponse = {
  data: YieldProduct[]
  hasNextPage: boolean
}

export type PendingAction = {
  type: string
  passthrough: string
}

export type YieldBalance = {
  groupId: string
  type: string
  amount: string
  token: YieldToken
  validatorAddress?: string
  pendingActions: PendingAction[]
}

export type YieldTransaction = {
  id: string
  title: string
  type: string // APPROVAL, SUPPLY, STAKE, UNSTAKE, etc.
  network: string
  status: string
  unsignedTransaction: string // JSON string — needs JSON.parse
  gasEstimate: string // JSON string — needs JSON.parse
}

export type YieldActionResponse = {
  id: string
  intent: string
  type: string
  yieldId: string
  amount: string
  amountRaw: string
  amountUsd: string
  transactions: YieldTransaction[]
}

// --- YieldDiscoverOpportunity — CRITICAL type exported from SDK ---

export type YieldDiscoverToken = {
  symbol: string
  network: string
  address?: string
  decimals?: number
  logoURI?: string
  name?: string
}

export type YieldDiscoverMetadata = {
  name: string
  type?: string
  cooldownPeriod?: { days: number }
  warmupPeriod?: { days: number }
  withdrawPeriod?: { days: number }
  description?: string
  documentationLink?: string
  logoURI?: string
  provider?: {
    id?: string
    name: string
    logoURI?: string
  }
}

export type YieldDiscoverOpportunity = {
  id: string
  token: YieldDiscoverToken
  tokens: YieldDiscoverToken[]
  /**
   * APY as a FRACTION (0..1). E.g. 0.0421 = 4.21%.
   * DO NOT convert to percent here — consumers are responsible for ×100.
   */
  apy: number
  tvl?: number
  metadata: YieldDiscoverMetadata // provider nested inside metadata
  status: { enter: boolean; exit: boolean }
  isAvailable: boolean
}

// --- Inline scan request types (mcp-ts helpers aren't available in the SDK) ---

export type EvmScanRequest = {
  kind: 'evm'
  chain: string
  from?: string
  to: string
  value: string
  data: string
}

export type UnsupportedScanRequest = {
  kind: 'unsupported'
  reason: string
}

export type ScanRequest = EvmScanRequest | UnsupportedScanRequest

// --- API functions ---

export async function searchYields(params: {
  apiKey?: string
  network?: string
  token?: string
  type?: string
  provider?: string
  limit?: number
}): Promise<YieldProduct[]> {
  const query = new URLSearchParams()
  if (params.network) query.set('network', params.network)
  if (params.token) query.set('token', params.token)
  if (params.type) query.set('type', params.type)
  if (params.provider) query.set('provider', params.provider)
  if (params.limit) query.set('limit', String(params.limit))

  const cacheKey = `yield:search:${query.toString()}`
  const cached = getCached<YieldProduct[]>(cacheKey)
  if (cached) return cached

  // `/yields/enabled` returns ONLY the products this project's API key
  // is allowed to deposit into via the actions/enter endpoint. The
  // unrestricted `/yields` endpoint returns yield.xyz's full catalog
  // including products the project doesn't have enabled, which previously
  // surfaced "yield X is not enabled for this project" 400s deep in the
  // signing flow.
  const url = `${STAKEKIT_API_BASE}/yields/enabled?${query.toString()}`
  const resp = await queryUrl<YieldListResponse>(url, {
    headers: authHeaders(params.apiKey),
  })
  const data = resp.data ?? []
  setCache(cacheKey, data, CACHE_TTL)
  return data
}

export async function getYield(yieldId: string, apiKey?: string): Promise<YieldProduct> {
  const cacheKey = `yield:detail:${yieldId}`
  const cached = getCached<YieldProduct>(cacheKey)
  if (cached) return cached

  const data = await queryUrl<YieldProduct>(
    `${STAKEKIT_API_BASE}/yields/${encodeURIComponent(yieldId)}`,
    { headers: authHeaders(apiKey) },
  )
  setCache(cacheKey, data, CACHE_TTL)
  return data
}

/**
 * Fetch yield positions for a wallet address on a given network.
 *
 * stakek.it's `/v1/yields/balances` is a POST endpoint that takes an
 * array of `{addresses, integrationId}` queries. Pre-fix: called as
 * `GET /v1/yields/balances?network=X&addresses=Y` which stakek.it
 * rejects with 400 `balances yield module not found`.
 *
 * Correct shape (verified 2026-05-27):
 *   POST /v1/yields/balances
 *   Body: [{addresses: {address: "0x..."}, integrationId: "ethereum-eth-lido-staking"}, ...]
 *   Returns: [{addresses, integrationId, balances: YieldBalance[]}, ...]
 */
export async function getBalances(
  address: string,
  network: string,
  apiKey?: string,
  yieldIds?: string[],
): Promise<YieldBalance[] | null> {
  let integrationIds = yieldIds
  if (!integrationIds || integrationIds.length === 0) {
    const enabled = await searchYields({ network, limit: 100, apiKey })
    integrationIds = enabled.map((y) => y.id)
  }
  if (integrationIds.length === 0) {
    return []
  }

  // stakek.it limits the batch to 15 ids per request.
  const BATCH = 15
  const out: YieldBalance[] = []
  for (let i = 0; i < integrationIds.length; i += BATCH) {
    const chunk = integrationIds.slice(i, i + BATCH)
    const body = chunk.map((integrationId) => ({
      addresses: { address },
      integrationId,
    }))
    const url = `${STAKEKIT_API_BASE}/yields/balances`
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (resp.status === 403) {
        return null
      }
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '')
        throw new Error(`yield.xyz API HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
      }
      const rows = (await resp.json()) as Array<{
        integrationId: string
        balances?: YieldBalance[]
      }>
      for (const row of rows) {
        for (const b of row.balances ?? []) out.push(b)
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('403')) {
        return null
      }
      throw e
    }
  }
  return out
}

export async function callYieldMCP(
  toolName: string,
  args: Record<string, unknown>,
  apiKey?: string,
): Promise<string> {
  const resp = await fetch(STAKEKIT_MCP_URL, {
    method: 'POST',
    headers: authHeaders(apiKey, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`yield.xyz MCP HTTP ${resp.status}: ${body.slice(0, 200)}`)
  }
  const data = (await resp.json()) as {
    result?: { content?: { text: string }[] }
    error?: { message: string }
  }
  if (data.error) throw new Error(`yield.xyz MCP: ${data.error.message}`)
  return data.result?.content?.[0]?.text ?? ''
}

export async function callYieldActionREST(
  yieldId: string,
  action: 'enter' | 'exit' | string,
  body: Record<string, unknown>,
  apiKey?: string,
): Promise<YieldActionResponse> {
  // Canonical stakek.it REST shape: `POST /v1/actions/{enter|exit|...}`
  // with `integrationId` in the body alongside `addresses` and `args`.
  const url = `${STAKEKIT_API_BASE}/actions/${encodeURIComponent(action)}`
  const fullBody = { integrationId: yieldId, ...body }
  const resp = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(fullBody),
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '')
    let humanMsg = respBody.slice(0, 200)
    try {
      const parsed = JSON.parse(respBody) as { message?: unknown }
      if (typeof parsed.message === 'string' && parsed.message.length > 0) {
        humanMsg = parsed.message
      }
    } catch {
      // not JSON — keep the raw slice
    }
    const enabledMatch = /not enabled for this project/i.test(humanMsg)
    const prefix = enabledMatch ? 'yield_not_enabled' : `yield_xyz_${resp.status}`
    throw new Error(`${prefix}: ${humanMsg}`)
  }
  const action_response = (await resp.json()) as YieldActionResponse
  // Some chains return the action with status:"CREATED" and every
  // transactions[].unsignedTransaction === null because yield.xyz hasn't
  // built the payload yet. PATCH each null tx to advance it.
  if (Array.isArray(action_response.transactions) && action_response.transactions.length > 0) {
    const needsBuild = action_response.transactions.some(
      (t) => (t as { unsignedTransaction?: unknown }).unsignedTransaction == null,
    )
    if (needsBuild) {
      const built = await Promise.all(
        action_response.transactions.map(async (tx) => {
          const txRec = tx as { id?: string; unsignedTransaction?: unknown }
          if (typeof txRec.id !== 'string' || txRec.unsignedTransaction != null) {
            return tx as unknown
          }
          return await buildYieldTransaction(txRec.id, tx, apiKey)
        }),
      )
      action_response.transactions = built as YieldActionResponse['transactions']
    }
  }
  return action_response
}

/**
 * Advance one yield.xyz transaction from `CREATED` → `WAITING_FOR_SIGNATURE`
 * by PATCH'ing it with an empty body. Internal — not exported.
 */
async function buildYieldTransaction(
  txId: string,
  fallback: unknown,
  apiKey?: string,
): Promise<unknown> {
  try {
    const url = `${STAKEKIT_API_BASE}/transactions/${encodeURIComponent(txId)}`
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders(apiKey, { 'Content-Type': 'application/json' }),
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok) return fallback
    const updated = (await resp.json()) as { unsignedTransaction?: unknown }
    if (updated && updated.unsignedTransaction != null) {
      return updated
    }
    return fallback
  } catch {
    return fallback
  }
}

export async function callYieldActionWithFallback(args: {
  mcpToolName: string
  mcpArgs: Record<string, unknown>
  yieldId: string
  restAction: 'enter' | 'exit' | string
  restBody: Record<string, unknown>
  apiKey?: string
  /**
   * Skip the hosted MCP and go straight to REST. Use when the hosted MCP
   * schema can't carry the args the chain requires (e.g. Tron `tronResource`).
   */
  preferRest?: boolean
}): Promise<string> {
  if (args.preferRest) {
    const json = await callYieldActionREST(args.yieldId, args.restAction, args.restBody, args.apiKey)
    return JSON.stringify(json)
  }
  try {
    return await callYieldMCP(args.mcpToolName, args.mcpArgs, args.apiKey)
  } catch (mcpErr) {
    const mcpMsg = mcpErr instanceof Error ? mcpErr.message : String(mcpErr)
    try {
      const json = await callYieldActionREST(args.yieldId, args.restAction, args.restBody, args.apiKey)
      return JSON.stringify(json)
    } catch (restErr) {
      const restMsg = restErr instanceof Error ? restErr.message : String(restErr)
      throw new Error(
        `yield.xyz action failed on BOTH hosted MCP and REST fallback — MCP: ${mcpMsg}; REST: ${restMsg}`,
        { cause: restErr },
      )
    }
  }
}

// --- Scan request builders ---

/**
 * Map yield.xyz network slugs to EVM chain names (PascalCase).
 */
function yieldNetworkToEvmChain(network: string): string | null {
  switch (network) {
    case 'ethereum': return 'Ethereum'
    case 'arbitrum': return 'Arbitrum'
    case 'base': return 'Base'
    case 'optimism': return 'Optimism'
    case 'polygon': return 'Polygon'
    case 'avalanche-c': return 'Avalanche'
    case 'binance': return 'BSC'
    case 'cronos': return 'CronosChain'
    case 'zksync': return 'Zksync'
    case 'sei': return 'Sei'
    default: return null
  }
}

type EvmUnsignedTx = {
  from?: string
  to?: string
  value?: string
  data?: string
}

function asEvmUnsignedTx(raw: string): EvmUnsignedTx | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const p = parsed as Record<string, unknown>
    return {
      from: typeof p.from === 'string' ? p.from : undefined,
      to: typeof p.to === 'string' ? p.to : undefined,
      value: typeof p.value === 'string' ? p.value : undefined,
      data: typeof p.data === 'string' ? p.data : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Build a scan_request for ONE step in a yield action's transactions[].
 * Returns an unsupported sentinel when the network/envelope shape can't be decoded.
 */
export function buildYieldStepScanRequest(tx: YieldTransaction): ScanRequest {
  const evmChain = yieldNetworkToEvmChain(tx.network)
  if (!evmChain) {
    const req: ScanRequest = { kind: 'unsupported', reason: 'chain_not_supported' }
    return req
  }
  const parsed = asEvmUnsignedTx(tx.unsignedTransaction)
  if (!parsed || !parsed.to || !parsed.data) {
    const req: ScanRequest = { kind: 'unsupported', reason: 'no_compiled_txs' }
    return req
  }
  const req: ScanRequest = {
    kind: 'evm',
    chain: evmChain,
    from: parsed.from,
    to: parsed.to,
    value: parsed.value ?? '0',
    data: parsed.data,
  }
  return req
}

/**
 * Build the scan_request for a yield action's RESPONSE envelope.
 * Returns the first non-unsupported step scan_request; falls back to
 * `{kind: 'unsupported', reason: 'no_compiled_txs'}` when all steps are unsupported.
 */
export function buildYieldActionScanRequest(resp: YieldActionResponse): ScanRequest {
  if (!resp.transactions?.length) {
    return { kind: 'unsupported', reason: 'no_compiled_txs' }
  }
  for (const step of resp.transactions) {
    const req = buildYieldStepScanRequest(step)
    if (req.kind !== 'unsupported') return req
  }
  return { kind: 'unsupported', reason: 'no_compiled_txs' }
}
