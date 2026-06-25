// sdk.defi.stakekit — yield.xyz / StakeKit enter/exit/manage builders.
//
// Ported from:
//   mcp-ts/src/lib/yield-api.ts (HTTP client + types)
//   mcp-ts/src/tools/yield/yield-tools.ts (parseActionDisplay, builders)
//   mcp-ts/src/lib/security/yieldScanRequest.ts (scan_request shapes)
//
// All builders are UNSIGNED-ONLY — never signs, never broadcasts.
// apiKey is injectable via every function param; never read from process.env.
//
// Key invariants:
//   - provider: "yield_xyz" at the action level (load-bearing for app routing)
//   - EVM steps: FLAT {to, value, data, action, description, ...} — NO tx_encoding field
//   - Non-EVM steps: HAVE tx_encoding field (solana-tx, sui-tx, tron-tx, ton-tx)
//   - All-or-nothing: if any step fails to canonicalize, decoded[] used for ALL steps

import type { ScanRequest, Validator, YieldActionResponse, YieldBalance, YieldProduct } from './stakekitApi'
import {
  buildYieldActionScanRequest,
  callYieldActionWithFallback,
  getBalances,
  getYield,
  searchYields,
} from './stakekitApi'

// Re-export all types and scan request builders from the API module
export type {
  EvmScanRequest,
  PendingAction,
  ScanRequest,
  UnsupportedScanRequest,
  Validator,
  YieldActionResponse,
  YieldArgs,
  YieldBalance,
  YieldDiscoverMetadata,
  YieldDiscoverOpportunity,
  YieldDiscoverToken,
  YieldListResponse,
  YieldMetadata,
  YieldProduct,
  YieldToken,
  YieldTransaction,
} from './stakekitApi'
export { buildYieldActionScanRequest, buildYieldStepScanRequest } from './stakekitApi'

// --- Inline withScanRequest helper ---
// (mcp-ts's withScanRequest isn't available in the SDK — inline it here)

function withScanRequest<T extends object>(scanRequest: ScanRequest, rest: T): { scan_request: ScanRequest } & T {
  return { scan_request: scanRequest, ...rest }
}

// --- Network mappings ---

/**
 * Map a yield.xyz network slug to the PascalCase chain name the app uses everywhere.
 * Mirrors mcp-ts's `yieldNetworkToCanonicalChain`.
 */
function yieldNetworkToCanonicalChain(network: string): string | null {
  switch (network) {
    case 'ethereum':
      return 'Ethereum'
    case 'arbitrum':
      return 'Arbitrum'
    case 'base':
      return 'Base'
    case 'optimism':
      return 'Optimism'
    case 'polygon':
      return 'Polygon'
    case 'avalanche-c':
      return 'Avalanche'
    case 'binance':
      return 'BSC'
    case 'cronos':
      return 'CronosChain'
    case 'zksync':
      return 'Zksync'
    case 'sei':
      return 'Sei'
    case 'solana':
      return 'Solana'
    case 'sui':
      return 'Sui'
    case 'tron':
      return 'Tron'
    case 'ton':
      return 'Ton'
    default:
      return null
  }
}

// EVM-family network slugs — EVM steps get the flat {to, value, data} shape (NO tx_encoding).
// Non-EVM steps get the tx_encoding wrapper.
const EVM_NETWORKS = new Set([
  'ethereum',
  'arbitrum',
  'base',
  'optimism',
  'polygon',
  'avalanche-c',
  'binance',
  'cronos',
  'zksync',
  'sei',
])

// --- parseActionDisplay (LOAD-BEARING — port byte-identical from yield-tools.ts:158-484) ---

/**
 * Map a yield.xyz `YieldActionResponse` to a display-ready canonical envelope.
 *
 * Key contracts:
 *   - EVM steps: flat `{to, value, data, action, description, from?, gas_limit?, ...}` — NO `tx_encoding`
 *   - Non-EVM steps: `{tx_encoding: 'solana-tx'|'sui-tx'|'tron-tx'|'ton-tx', chain, data, action, description}`
 *   - `provider: "yield_xyz"` at action level (load-bearing for app chip routing, NEVER rename)
 *   - All-or-nothing: if any step fails to canonicalize → decoded[] used for ALL steps
 *   - `chain` field (PascalCase) derived from first tx network
 */
export function parseActionDisplay(data: YieldActionResponse) {
  const decoded = data.transactions.map(tx => {
    let unsigned: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(tx.unsignedTransaction) as unknown
      if (parsed && typeof parsed === 'object') {
        unsigned = parsed as Record<string, unknown>
      }
    } catch {
      // Keep raw on parse failure
    }
    let gasInfo: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(tx.gasEstimate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        gasInfo = parsed as Record<string, unknown>
      }
    } catch {
      /* intentionally empty */
    }
    return {
      title: tx.title,
      type: tx.type,
      network: tx.network,
      unsignedTransaction: unsigned ?? tx.unsignedTransaction,
      gasEstimateObj: gasInfo,
    }
  })

  const firstNetwork = typeof data.transactions[0]?.network === 'string' ? data.transactions[0].network : null
  const chain = firstNetwork ? yieldNetworkToCanonicalChain(firstNetwork) : null

  const canonicalSteps = decoded.map(step => {
    const u = step.unsignedTransaction
    if (!u || !chain) return null
    const stepNetwork = typeof step.network === 'string' ? step.network : null
    if (!stepNetwork) return null

    // EVM: flat shape, NO tx_encoding field
    if (EVM_NETWORKS.has(stepNetwork)) {
      if (typeof u !== 'object') return null
      const evm = u as { to?: unknown; value?: unknown; data?: unknown; from?: unknown }
      if (typeof evm.to !== 'string' || typeof evm.data !== 'string') return null
      const ur = u as Record<string, unknown>
      const out: Record<string, unknown> = {
        to: evm.to,
        value: typeof evm.value === 'string' ? evm.value : '0x0',
        data: evm.data,
        action: step.type ?? 'yield_step',
        description: step.title ?? `Yield ${step.type ?? 'step'}`,
      }
      if (typeof evm.from === 'string') out.from = evm.from
      // Pass-through gas hints from unsignedTransaction or gasEstimate fallback
      const ge = step.gasEstimateObj ?? {}
      const gasLimitVal =
        (typeof ur.gasLimit === 'string' ? ur.gasLimit : null) ??
        (typeof ge.gasLimit === 'string' ? ge.gasLimit : null) ??
        (typeof ge.gas_limit === 'string' ? ge.gas_limit : null)
      const maxFeeVal =
        (typeof ur.maxFeePerGas === 'string' ? ur.maxFeePerGas : null) ??
        (typeof ge.maxFeePerGas === 'string' ? ge.maxFeePerGas : null) ??
        (typeof ge.max_fee_per_gas === 'string' ? ge.max_fee_per_gas : null)
      const maxPrioVal =
        (typeof ur.maxPriorityFeePerGas === 'string' ? ur.maxPriorityFeePerGas : null) ??
        (typeof ge.maxPriorityFeePerGas === 'string' ? ge.maxPriorityFeePerGas : null)
      if (gasLimitVal !== null) out.gas_limit = gasLimitVal
      if (maxFeeVal !== null) out.max_fee_per_gas = maxFeeVal
      if (maxPrioVal !== null) out.max_priority_fee_per_gas = maxPrioVal
      return out
    }

    // Solana: raw base64 VersionedTransaction or {serialized/tx} wrapper
    if (stepNetwork === 'solana') {
      let candidate: string | null = null
      if (typeof u === 'string') {
        candidate = u
      } else if (typeof u === 'object') {
        const sol = u as { serialized?: unknown; tx?: unknown }
        candidate =
          (typeof sol.serialized === 'string' && sol.serialized) || (typeof sol.tx === 'string' && sol.tx) || null
      }
      if (typeof candidate !== 'string' || candidate.length === 0) return null
      return {
        tx_encoding: 'solana-tx',
        chain: 'Solana',
        data: candidate,
        action: step.type ?? 'yield_step',
        description: step.title ?? `Yield ${step.type ?? 'step'}`,
      }
    }

    // Sui: raw base64 PTB or {serialized/tx} wrapper
    if (stepNetwork === 'sui') {
      let candidate: string | null = null
      if (typeof u === 'string') {
        candidate = u
      } else if (typeof u === 'object') {
        const sui = u as { serialized?: unknown; tx?: unknown }
        candidate =
          (typeof sui.serialized === 'string' && sui.serialized) || (typeof sui.tx === 'string' && sui.tx) || null
      }
      if (typeof candidate !== 'string' || candidate.length === 0) return null
      return {
        tx_encoding: 'sui-tx',
        chain: 'Sui',
        data: candidate,
        action: step.type ?? 'yield_step',
        description: step.title ?? `Yield ${step.type ?? 'step'}`,
      }
    }

    // Tron: raw_data hex or {rawDataHex/raw_data} wrapper
    if (stepNetwork === 'tron') {
      let candidate: string | null = null
      if (typeof u === 'string') {
        candidate = u
      } else if (typeof u === 'object') {
        const tron = u as { rawDataHex?: unknown; raw_data?: unknown }
        candidate =
          (typeof tron.rawDataHex === 'string' && tron.rawDataHex) ||
          (typeof tron.raw_data === 'string' && tron.raw_data) ||
          null
      }
      if (typeof candidate !== 'string' || candidate.length === 0) return null
      return {
        tx_encoding: 'tron-tx',
        chain: 'Tron',
        data: candidate,
        action: step.type ?? 'yield_step',
        description: step.title ?? `Yield ${step.type ?? 'step'}`,
      }
    }

    // Ton: BoC base64 or {bocBase64/boc/signingPayload} wrapper, forwarding seqno+validUntil
    if (stepNetwork === 'ton') {
      let candidate: string | null = null
      let seqnoOut: number | undefined
      let validUntilOut: number | undefined
      if (typeof u === 'string') {
        candidate = u
      } else if (typeof u === 'object') {
        const ton = u as {
          bocBase64?: unknown
          boc?: unknown
          signingPayload?: unknown
          seqno?: unknown
          validUntil?: unknown
        }
        candidate =
          (typeof ton.bocBase64 === 'string' && ton.bocBase64) ||
          (typeof ton.boc === 'string' && ton.boc) ||
          (typeof ton.signingPayload === 'string' && ton.signingPayload) ||
          null
        if (typeof ton.seqno === 'number') seqnoOut = ton.seqno
        if (typeof ton.validUntil === 'number') validUntilOut = ton.validUntil
      }
      if (typeof candidate !== 'string' || candidate.length === 0) return null
      const out: Record<string, unknown> = {
        tx_encoding: 'ton-tx',
        chain: 'Ton',
        data: candidate,
        action: step.type ?? 'yield_step',
        description: step.title ?? `Yield ${step.type ?? 'step'}`,
      }
      if (seqnoOut !== undefined) out.seqno = seqnoOut
      if (validUntilOut !== undefined) out.valid_until = validUntilOut
      return out
    }

    // Cardano and others: no app-side parser branch yet
    return null
  })

  // All-or-nothing: if any step fails to canonicalize, fall back to `decoded` for all steps.
  const allCanonicalized = canonicalSteps.every(s => s !== null)
  const transactions = allCanonicalized ? (canonicalSteps as NonNullable<(typeof canonicalSteps)[number]>[]) : []

  return {
    intent: data.intent,
    type: data.type,
    yieldId: data.yieldId,
    amount: data.amount,
    amountUsd: data.amountUsd,
    chain,
    // `provider: "yield_xyz"` — LOAD-BEARING for app chip routing, NEVER rename
    provider: 'yield_xyz',
    transactions: transactions.length > 0 ? transactions : decoded,
  }
}

// --- Validator picker ---

function pickValidators(validators: Validator[]): string[] {
  if (validators.length === 0) return []
  const preferred = validators.find(v => v.preferred)
  if (preferred) return [preferred.address]
  const topByStake = [...validators].sort((a, b) => {
    const bn = (s: string) => {
      try {
        return BigInt(s)
      } catch {
        return 0n
      }
    }
    const diff = bn(b.stakedBalance) - bn(a.stakedBalance)
    return diff > 0n ? 1 : diff < 0n ? -1 : 0
  })[0]
  return topByStake ? [topByStake.address] : []
}

async function resolveActionArgs(
  yieldId: string,
  action: 'enter' | 'exit',
  userArgs: { validatorAddresses?: string[]; tronResource?: string },
  apiKey?: string
): Promise<{
  validatorAddressForMCP?: string
  validatorAddressesForREST?: string[]
  extras: Record<string, unknown>
}> {
  const product = await getYield(yieldId, apiKey).catch(() => null)
  const schema = (product?.args?.[action]?.args ?? {}) as Record<string, { required?: boolean; options?: string[] }>
  const validatorsNeeded =
    'validatorAddresses' in schema || 'validatorAddress' in schema || (product?.validators ?? []).length > 0

  const requested = userArgs.validatorAddresses
  let resolvedValidators: string[] = requested && requested.length > 0 ? requested : []
  if (validatorsNeeded && resolvedValidators.length === 0 && product) {
    resolvedValidators = pickValidators(product.validators ?? [])
  }

  const extras: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(schema)) {
    if (!def.required) continue
    if (key === 'amount' || key === 'validatorAddresses' || key === 'validatorAddress') continue
    if (key === 'tronResource') {
      extras.tronResource = userArgs.tronResource ?? 'BANDWIDTH'
      continue
    }
  }
  // Chain-specific defaults for schemas that omit required fields
  if (!('tronResource' in extras) && yieldId.startsWith('tron-')) {
    extras.tronResource = userArgs.tronResource ?? 'BANDWIDTH'
  }
  if (userArgs.tronResource) extras.tronResource = userArgs.tronResource

  return {
    validatorAddressForMCP: resolvedValidators[0],
    validatorAddressesForREST: resolvedValidators.length > 0 ? resolvedValidators : undefined,
    extras,
  }
}

// --- Builder functions ---

/**
 * Search yield opportunities. Wraps searchYields with client-side token/provider filtering.
 * apiKey is injectable; omit for unauthenticated read-only access.
 */
export async function stakekitSearch(params: {
  apiKey?: string
  network?: string
  token?: string
  type?: string
  provider?: string
  limit?: number
}): Promise<YieldProduct[]> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50)

  const NETWORK_ALIASES: Record<string, string> = {
    bsc: 'binance',
    'bnb chain': 'binance',
    'bnb-chain': 'binance',
    bnbchain: 'binance',
    avalanche: 'avalanche-c',
    avax: 'avalanche-c',
  }
  const aliasedNetwork = params.network
    ? (NETWORK_ALIASES[params.network.toLowerCase()] ?? params.network.toLowerCase())
    : undefined

  const wantsClientFilter = !!params.token || !!params.provider
  const apiLimit = wantsClientFilter ? 100 : limit

  let products = await searchYields({
    apiKey: params.apiKey,
    network: aliasedNetwork,
    type: params.type,
    provider: params.provider?.toLowerCase(),
    limit: apiLimit,
  })

  if (params.token) {
    products = products.filter(y => y.token.symbol.toLowerCase() === params.token!.toLowerCase())
  }

  if (params.provider) {
    const needle = params.provider.toLowerCase().replace(/[\s\-_]/g, '')
    products = products.filter(y => {
      const name = y.metadata.provider?.name ?? ''
      return name
        .toLowerCase()
        .replace(/[\s\-_]/g, '')
        .includes(needle)
    })
  }

  if (products.length > limit) {
    products = products.slice(0, limit)
  }

  return products
}

/** Get full yield product metadata. */
export async function stakekitDetails(params: { apiKey?: string; yieldId: string }): Promise<object> {
  const p = await getYield(params.yieldId, params.apiKey)
  return {
    id: p.id,
    name: p.metadata.name,
    token: p.token.symbol,
    network: p.token.network,
    apy: p.apy,
    type: p.metadata.type,
    provider: p.metadata.provider?.name ?? '',
    isAvailable: p.isAvailable,
    fee: p.fee?.enabled ? { percentage: p.fee.percentage } : null,
    cooldownDays: p.metadata.cooldownPeriod?.days ?? 0,
    warmupDays: p.metadata.warmupPeriod?.days ?? 0,
    rewardSchedule: p.metadata.rewardSchedule ?? '',
    rewardClaiming: p.metadata.rewardClaiming ?? '',
    enterEnabled: p.status.enter,
    exitEnabled: p.status.exit,
    acceptedTokens: p.tokens.map(t => ({ symbol: t.symbol, network: t.network, address: t.address })),
  }
}

/** Fetch yield positions for a wallet on a network. */
export async function stakekitBalances(params: {
  apiKey?: string
  address: string
  network: string
}): Promise<YieldBalance[] | null> {
  return getBalances(params.address, params.network?.toLowerCase(), params.apiKey)
}

// Action-input validation — ported verbatim from mcp-ts yield-tools.ts
// (validateActionAddress / validateActionInput, Apo r1/r2 on companion #192).
// A 0x-prefixed address must be EVM (40 hex) or Sui (64 hex); a 42-char "EVM-ish"
// or any other 0x length is rejected locally instead of being forwarded to
// yield.xyz as an opaque 4xx. Non-0x addresses (Cosmos/Solana/Tron/TON) pass
// through — yield.xyz validates them server-side.
const STAKEKIT_EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const STAKEKIT_SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/** Returns null when valid, else a human-readable error string. */
export function validateStakekitActionAddress(address: string): string | null {
  if (STAKEKIT_EVM_ADDRESS_RE.test(address)) return null
  if (STAKEKIT_SUI_ADDRESS_RE.test(address)) return null
  if (address.startsWith('0x')) {
    return 'Invalid 0x-prefixed address: expected EVM (40 hex chars) or Sui (64 hex chars).'
  }
  return null
}

/** Address + positive-amount validation. Returns null when valid, else an error string. */
export function validateStakekitActionInput(address: string, amount: string): string | null {
  const addrErr = validateStakekitActionAddress(address)
  if (addrErr !== null) return addrErr
  const num = Number(amount)
  if (Number.isNaN(num) || num <= 0) {
    return 'Invalid amount. Must be a positive number.'
  }
  return null
}

/**
 * Build unsigned enter (deposit/stake) transactions for a yield position.
 * Returns the parseActionDisplay envelope with scan_request prepended.
 * UNSIGNED — never signs, never broadcasts.
 */
export async function stakekitBuildEnter(params: {
  apiKey?: string
  yieldId: string
  address: string
  amount: string
  validatorAddresses?: string[]
  tronResource?: 'BANDWIDTH' | 'ENERGY'
}): Promise<object> {
  const inputErr = validateStakekitActionInput(params.address, params.amount)
  if (inputErr) throw new Error(inputErr)
  const resolved = await resolveActionArgs(
    params.yieldId,
    'enter',
    { validatorAddresses: params.validatorAddresses, tronResource: params.tronResource },
    params.apiKey
  )

  const mcpArgs: Record<string, unknown> = {
    yieldId: params.yieldId,
    address: params.address,
    amount: params.amount,
    ...(resolved.validatorAddressForMCP ? { validatorAddress: resolved.validatorAddressForMCP } : {}),
    ...resolved.extras,
  }

  const raw = await callYieldActionWithFallback({
    mcpToolName: 'actions_enter',
    mcpArgs,
    yieldId: params.yieldId,
    restAction: 'enter',
    restBody: {
      addresses: { address: params.address },
      args: {
        amount: params.amount,
        ...resolved.extras,
        ...(resolved.validatorAddressesForREST ? { validatorAddresses: resolved.validatorAddressesForREST } : {}),
      },
    },
    apiKey: params.apiKey,
    preferRest: params.yieldId.startsWith('tron-'),
  })
  if (!raw) throw new Error('No response from yield.xyz')

  let actionData: YieldActionResponse
  try {
    actionData = JSON.parse(raw) as YieldActionResponse
  } catch {
    throw new Error(raw || 'yield.xyz returned an invalid response')
  }
  if (!actionData.transactions) throw new Error('yield.xyz returned no transactions')

  const display = parseActionDisplay(actionData)
  const scanRequest = buildYieldActionScanRequest(actionData)
  return withScanRequest(scanRequest, display)
}

/**
 * Build unsigned exit (withdraw/unstake) transactions.
 * Includes `cooldown_days` when the protocol has a cooldown period.
 * UNSIGNED — never signs, never broadcasts.
 */
export async function stakekitBuildExit(params: {
  apiKey?: string
  yieldId: string
  address: string
  amount: string
  validatorAddresses?: string[]
  tronResource?: 'BANDWIDTH' | 'ENERGY'
}): Promise<object> {
  const inputErr = validateStakekitActionInput(params.address, params.amount)
  if (inputErr) throw new Error(inputErr)
  const resolved = await resolveActionArgs(
    params.yieldId,
    'exit',
    { validatorAddresses: params.validatorAddresses, tronResource: params.tronResource },
    params.apiKey
  )

  const mcpArgs: Record<string, unknown> = {
    yieldId: params.yieldId,
    address: params.address,
    amount: params.amount,
    ...(resolved.validatorAddressForMCP ? { validatorAddress: resolved.validatorAddressForMCP } : {}),
    ...resolved.extras,
  }

  const [raw, yieldMeta] = await Promise.all([
    callYieldActionWithFallback({
      mcpToolName: 'actions_exit',
      mcpArgs,
      yieldId: params.yieldId,
      restAction: 'exit',
      restBody: {
        addresses: { address: params.address },
        args: { amount: params.amount, ...resolved.extras },
        ...(resolved.validatorAddressesForREST ? { validatorAddresses: resolved.validatorAddressesForREST } : {}),
      },
      apiKey: params.apiKey,
      preferRest: params.yieldId.startsWith('tron-'),
    }),
    getYield(params.yieldId, params.apiKey).catch(() => null),
  ])
  if (!raw) throw new Error('No response from yield.xyz')

  let actionData: YieldActionResponse
  try {
    actionData = JSON.parse(raw) as YieldActionResponse
  } catch {
    throw new Error(raw || 'yield.xyz returned an invalid response')
  }
  if (!actionData.transactions) throw new Error('yield.xyz returned no transactions')

  const display = parseActionDisplay(actionData)
  const scanRequest = buildYieldActionScanRequest(actionData)
  const cooldownDays = yieldMeta?.metadata?.cooldownPeriod?.days ?? null
  return {
    ...withScanRequest(scanRequest, display),
    ...(cooldownDays !== null ? { cooldown_days: cooldownDays } : {}),
  }
}

/**
 * Build unsigned manage transactions (claim rewards, restake, withdraw, etc.).
 * UNSIGNED — never signs, never broadcasts.
 */
export async function stakekitBuildManage(params: {
  apiKey?: string
  yieldId: string
  address: string
  action:
    | 'CLAIM_REWARDS'
    | 'RESTAKE_REWARDS'
    | 'WITHDRAW'
    | 'WITHDRAW_ALL'
    | 'CLAIM_UNSTAKED'
    | 'UNLOCK_LOCKED'
    | 'RESTAKE'
  passthrough: string
}): Promise<object> {
  const addrErr = validateStakekitActionAddress(params.address)
  if (addrErr) throw new Error(addrErr)
  const raw = await callYieldActionWithFallback({
    mcpToolName: 'actions_manage',
    mcpArgs: {
      yieldId: params.yieldId,
      address: params.address,
      action: params.action,
      passthrough: params.passthrough,
    },
    yieldId: params.yieldId,
    restAction: 'pending-action',
    restBody: {
      addresses: { address: params.address },
      args: { passthrough: params.passthrough, type: params.action },
    },
    apiKey: params.apiKey,
  })
  if (!raw) throw new Error('No response from yield.xyz')

  let actionData: YieldActionResponse
  try {
    actionData = JSON.parse(raw) as YieldActionResponse
  } catch {
    throw new Error(raw || 'yield.xyz returned an invalid response')
  }
  if (!actionData.transactions) throw new Error('yield.xyz returned no transactions')

  const display = parseActionDisplay(actionData)
  const scanRequest = buildYieldActionScanRequest(actionData)
  return withScanRequest(scanRequest, display)
}

/** The sdk.defi.stakekit namespace surface. */
export const stakekit = {
  search: stakekitSearch,
  details: stakekitDetails,
  balances: stakekitBalances,
  buildEnter: stakekitBuildEnter,
  buildExit: stakekitBuildExit,
  buildManage: stakekitBuildManage,
} as const
