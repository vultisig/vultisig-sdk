import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'

import { getTokenMetadata } from '../token'

/**
 * Pure-read Cosmos bank-denom balance primitive.
 *
 * Fetches the full `cosmos/bank/v1beta1/balances/<address>` LCD response,
 * decimal-scales the native denom + any KNOWN denoms (curated registry +
 * on-chain `getTokenMetadata` denom-trace resolution for IBC vouchers), and
 * emits a renderable, decode-only balance list.
 *
 * Read-only: no signing, no broadcast, no agent-judgement. The handler never
 * decides whether a balance "matches user intent" — it only fetches, decodes,
 * validates the wire FORMAT, and decimal-scales. Mispricing is structurally
 * avoided: any denom whose decimals we cannot prove is emitted in raw base
 * units with a `(base units)` symbol caveat and `decimals: null`, so a wrong
 * decimal can never silently mis-scale a balance.
 *
 * Ported from mcp-ts `src/tools/balance/cosmos-balance.ts`; the LCD fetch +
 * Polkachu fallback are inlined here so the SDK carries no mcp-ts dependency.
 */

/** A Cosmos chain the SDK can read bank balances for. */
export type CosmosBalanceChain = CosmosChain

type CosmosChainConfig = {
  /** Native fee/staking denom (e.g. `uosmo`). */
  denom: string
  /** Human ticker for the native denom (e.g. `OSMO`). */
  ticker: string
  /** Native denom decimals. */
  decimals: number
  /** Primary LCD REST base URL. */
  restUrl: string
  /**
   * Canonical Cosmos-SDK chain_id, used to pick the Polkachu fallback mirror
   * (`POLKACHU_LCD_FALLBACKS`). `null` disables fallback for that chain.
   */
  polkachuChainKey: string | null
  /**
   * Bech32 human-readable prefix (HRP) for this chain's addresses (e.g.
   * `osmo`, `cosmos`, `terra`). Used by the offline mis-pair guard in
   * `getCosmosBalance` to fail loud when an address is routed to the wrong
   * chain, rather than silently querying a foreign LCD and returning a
   * confidently-wrong (often empty) balance. Mirrors mcp-ts's `bech32Prefix`.
   * Note: Terra v2 + TerraClassic share the `terra` HRP, so this guard can
   * only catch CROSS-HRP mis-pairs (e.g. `osmo1...` → Chain.Cosmos); the
   * Terra↔TerraClassic same-HRP case is documented as a caller contract.
   */
  bech32Prefix: string
}

// Endpoints mirror the mcp-ts cosmos-balance config (verified live there).
// THORChain/MayaChain are intentionally omitted: their balance enrichment
// goes through the Rujira path in mcp-ts, not the vanilla bank-denom LCD this
// primitive models. They stay in the orchestration layer for now.
const COSMOS_CONFIG: Record<CosmosBalanceChain, CosmosChainConfig | undefined> = {
  [CosmosChain.Cosmos]: {
    denom: 'uatom',
    ticker: 'ATOM',
    decimals: 6,
    restUrl: 'https://cosmos-rest.publicnode.com',
    polkachuChainKey: 'cosmoshub-4',
    bech32Prefix: 'cosmos',
  },
  [CosmosChain.Osmosis]: {
    denom: 'uosmo',
    ticker: 'OSMO',
    decimals: 6,
    restUrl: 'https://osmosis-rest.publicnode.com',
    polkachuChainKey: 'osmosis-1',
    bech32Prefix: 'osmo',
  },
  [CosmosChain.Kujira]: {
    denom: 'ukuji',
    ticker: 'KUJI',
    decimals: 6,
    restUrl: 'https://rest.cosmos.directory/kujira',
    polkachuChainKey: 'kaiyo-1',
    bech32Prefix: 'kujira',
  },
  [CosmosChain.Terra]: {
    denom: 'uluna',
    ticker: 'LUNA',
    decimals: 6,
    restUrl: 'https://terra-lcd.publicnode.com',
    polkachuChainKey: 'phoenix-1',
    bech32Prefix: 'terra',
  },
  [CosmosChain.TerraClassic]: {
    denom: 'uluna',
    ticker: 'LUNC',
    decimals: 6,
    restUrl: 'https://terra-classic-lcd.publicnode.com',
    polkachuChainKey: 'columbus-5',
    bech32Prefix: 'terra',
  },
  [CosmosChain.Noble]: {
    denom: 'uusdc',
    ticker: 'USDC',
    decimals: 6,
    restUrl: 'https://noble-api.polkachu.com',
    polkachuChainKey: 'noble-1',
    bech32Prefix: 'noble',
  },
  [CosmosChain.Dydx]: {
    denom: 'adydx',
    ticker: 'DYDX',
    decimals: 18,
    restUrl: 'https://dydx-rest.publicnode.com',
    polkachuChainKey: 'dydx-mainnet-1',
    bech32Prefix: 'dydx',
  },
  [CosmosChain.Akash]: {
    denom: 'uakt',
    ticker: 'AKT',
    decimals: 6,
    restUrl: 'https://akash-rest.publicnode.com',
    polkachuChainKey: 'akashnet-2',
    bech32Prefix: 'akash',
  },
  // Rujira-enriched chains — not modeled by the vanilla bank-denom path.
  [CosmosChain.THORChain]: undefined,
  [CosmosChain.MayaChain]: undefined,
}

/**
 * Polkachu LCD fallback mirrors keyed by chain_id. Mirrors the mcp-ts table;
 * READ ops via the mirror are idempotent so falling back on a primary
 * network/5xx failure is always safe.
 */
const POLKACHU_LCD_FALLBACKS: Record<string, string> = {
  'cosmoshub-4': 'https://cosmos-api.polkachu.com',
  'osmosis-1': 'https://osmosis-api.polkachu.com',
  'kaiyo-1': 'https://kujira-api.polkachu.com',
  'phoenix-1': 'https://terra-api.polkachu.com',
  'columbus-5': 'https://lcd.terra-classic.hexxagon.io',
  'noble-1': 'https://noble-api.polkachu.com',
  'dydx-mainnet-1': 'https://dydx-api.polkachu.com',
  'akashnet-2': 'https://akash-api.polkachu.com',
}

// Authoritative decimals for well-known cosmos IBC assets, keyed by the SYMBOL
// the SDK token-metadata resolver returns. We deliberately do NOT trust the
// resolver's `decimals`: its denom_trace fallback hardcodes the chain's
// fee-coin decimals (6 on Osmosis) for ANY non-registry denom, silently
// mis-scaling 18-decimal bridged assets by 10^12. Gating on this table means
// only assets whose decimals we KNOW resolve; unknown/ambiguous denoms stay on
// the honest base-units path rather than rendering a confidently-wrong number.
const IBC_SAFE_DECIMALS: Record<string, number> = {
  ATOM: 6,
  OSMO: 6,
  USDC: 6,
  AXLUSDC: 6,
  USDT: 6,
  STATOM: 6,
  STOSMO: 6,
  STTIA: 6,
  STDYDX: 6,
  TIA: 6,
  LUNA: 6,
  LUNC: 6,
  USTC: 6,
  AKT: 6,
  KUJI: 6,
  USK: 6,
  NTRN: 6,
  SCRT: 6,
  STARS: 6,
  JUNO: 6,
  EVMOS: 18,
  INJ: 18,
  DYDX: 18,
}

// Known plain-string + IBC-hash denoms → { symbol, decimals }. Curated mirror
// of vultisig-windows knownTokens/cosmos.ts; lets common holdings render with
// proper symbol + decimals even without the on-chain denom_trace round-trip.
const KNOWN_DENOMS: Record<string, { symbol: string; decimals: number }> = {
  // TerraClassic legacy native denoms (full mcp-ts parity — the SDK port had
  // dropped all but uusd/ukrw, silently regressing every other Terra-fiat
  // legacy denom to a raw `denom`-as-symbol passthrough).
  uusd: { symbol: 'USTC', decimals: 6 },
  ukrw: { symbol: 'KRTC', decimals: 6 },
  usdr: { symbol: 'SDTC', decimals: 6 },
  ueur: { symbol: 'EUTC', decimals: 6 },
  ucny: { symbol: 'CNTC', decimals: 6 },
  ujpy: { symbol: 'JPTC', decimals: 6 },
  ugbp: { symbol: 'GBTC', decimals: 6 },
  uinr: { symbol: 'INTC', decimals: 6 },
  ucad: { symbol: 'CATC', decimals: 6 },
  uchf: { symbol: 'CHTC', decimals: 6 },
  uaud: { symbol: 'AUTC', decimals: 6 },
  usgd: { symbol: 'SGTC', decimals: 6 },
  uthb: { symbol: 'THTC', decimals: 6 },
  unok: { symbol: 'NOTC', decimals: 6 },
  udkk: { symbol: 'DATC', decimals: 6 },
  uidr: { symbol: 'IDTC', decimals: 6 },
  // Osmosis-1 IBC denom hashes (chain-registry verified).
  'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2': { symbol: 'ATOM', decimals: 6 },
  'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4': { symbol: 'USDC', decimals: 6 },
  'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858': { symbol: 'axlUSDC', decimals: 6 },
  'ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901': { symbol: 'stATOM', decimals: 6 },
  'ibc/D176154B0C63D1F9C6DCFB4F70349EBF2E2B5A87A05902F57A6AE92B863E9AEC': { symbol: 'stOSMO', decimals: 6 },
  'ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877': { symbol: 'TIA', decimals: 6 },
}

const MAX_RETRIES = 2
const BASE_DELAY_MS = 300
const DEFAULT_TIMEOUT_MS = 15_000

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const isTimeout = (error: unknown): boolean => error instanceof DOMException && error.name === 'TimeoutError'

/** Bounded-retry JSON GET with timeout. 4xx fails fast; 5xx/network retried. */
async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
      if (response.ok) return (await response.json()) as T
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }
      if (attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }
      throw new Error(`HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`)
    } catch (error) {
      const retryable = isTimeout(error) || error instanceof TypeError
      if (retryable && attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * 2 ** attempt)
        continue
      }
      throw error
    }
  }
  throw new Error('unreachable')
}

const shouldFallback = (error: unknown): boolean => {
  if (isTimeout(error)) return true
  if (error instanceof TypeError) return true
  if (error instanceof Error) return /HTTP 5\d{2}/.test(error.message)
  return false
}

/**
 * Cosmos LCD GET with automatic Polkachu fallback. Tries the primary URL,
 * and on network/5xx failure falls back to the configured mirror. 4xx errors
 * are not hidden behind the fallback (they would fail there too).
 */
async function cosmosLcdGet<T>(primaryUrl: string, path: string, chainId: string | null): Promise<T> {
  const fullUrl = `${primaryUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
  try {
    return await fetchJson<T>(fullUrl)
  } catch (primaryErr) {
    if (!chainId || !shouldFallback(primaryErr)) throw primaryErr
    const fallbackBase = POLKACHU_LCD_FALLBACKS[chainId]
    if (!fallbackBase) throw primaryErr
    const fallbackUrl = `${fallbackBase}${path.startsWith('/') ? '' : '/'}${path}`
    try {
      return await fetchJson<T>(fallbackUrl)
    } catch (fallbackErr) {
      const pm = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      const fm = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      throw new Error(
        `Cosmos LCD both primary + Polkachu fallback failed for ${chainId} ${path}. primary=${primaryUrl}: ${pm}. fallback=${fallbackBase}: ${fm}`,
        { cause: fallbackErr }
      )
    }
  }
}

/** Decimal-scale a base-unit integer string. Pure, no rounding loss (BigInt). */
function formatBalance(raw: string, decimals: number): string {
  const big = BigInt(raw || '0')
  const divisor = 10n ** BigInt(decimals)
  const whole = big / divisor
  const frac = big % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

const isUnresolvedHashDenom = (denom: string): boolean => denom.startsWith('ibc/') || denom.startsWith('factory/')

/**
 * Extract the bech32 HRP (everything before the first `1` separator) from a
 * cosmos address. Pure-offline, no decode/checksum — we only need the prefix
 * to detect a cross-chain mis-pair. Returns `''` for malformed input.
 *
 * @example bech32Hrp('osmo1abc') === 'osmo'
 */
function bech32Hrp(address: string): string {
  const sep = address.lastIndexOf('1')
  return sep <= 0 ? '' : address.slice(0, sep)
}

/** Short, readable symbol for an unresolved ibc/ or factory/ denom. */
function unresolvedSymbol(denom: string): string {
  if (denom.startsWith('ibc/')) return `ibc/${denom.slice(4).slice(0, 8)}...`
  const parts = denom.split('/')
  if (parts.length >= 3) {
    const creator = parts[1]
    const frag = creator.length > 14 ? `${creator.slice(0, 10)}...${creator.slice(-4)}` : creator
    return `factory/${frag}/${parts[parts.length - 1]}`
  }
  return denom
}

/**
 * Resolve `ibc/<hash>` denoms to { symbol, decimals } via the SDK
 * `getTokenMetadata` resolver, with decimals PINNED from IBC_SAFE_DECIMALS so a
 * wrong fallback decimal can never mis-scale. Best-effort + parallel; never
 * throws (a balance read must not fail on a metadata lookup).
 */
async function resolveIbcDenoms(
  chain: CosmosBalanceChain,
  denoms: string[]
): Promise<Map<string, { symbol: string; decimals: number }>> {
  const out = new Map<string, { symbol: string; decimals: number }>()
  if (denoms.length === 0) return out
  await Promise.all(
    denoms.map(async id => {
      try {
        const meta = await getTokenMetadata({
          chain: chain as Parameters<typeof getTokenMetadata>[0]['chain'],
          id,
        })
        const symbol = meta?.ticker?.toUpperCase()
        if (!symbol) return
        const decimals = IBC_SAFE_DECIMALS[symbol]
        if (typeof decimals === 'number') out.set(id, { symbol, decimals })
      } catch {
        // leave unresolved — falls through to the base-units caveat path
      }
    })
  )
  return out
}

/** A single decoded bank-denom balance entry. */
export type CosmosBalanceEntry = {
  /** Raw on-chain denom (`uosmo`, `ibc/<hash>`, `factory/...`). */
  denom: string
  /** Human symbol; carries a `(base units)` caveat when decimals are unknown. */
  symbol: string
  /** Raw base-unit integer amount as a string. */
  amount: string
  /** Decimal-scaled human amount. Equals `amount` for unresolved denoms. */
  formatted?: string
  /** Decimals used for scaling; `null` when unresolved. */
  decimals?: number | null
  /** True when symbol + decimals could not be safely resolved. */
  unresolved?: boolean
}

/** Result of a Cosmos bank-denom balance read. */
export type CosmosBalanceResult = {
  chain: CosmosBalanceChain
  address: string
  /** Decimal-scaled native balance (e.g. OSMO). */
  nativeFormatted: string
  /** Raw base-unit native balance. */
  nativeRaw: string
  /** Native denom ticker. */
  nativeTicker: string
  /** Every non-zero denom held, decoded + decimal-scaled where known. */
  balances: CosmosBalanceEntry[]
  /** ISO-8601 timestamp of the read. */
  asOf: string
}

type BankBalancesResponse = { balances?: { denom: string; amount: string }[] }

/**
 * Read the full bank-denom balance set for a Cosmos address.
 *
 * @example
 * ```ts
 * const res = await getCosmosBalance(Chain.Osmosis, 'osmo1...')
 * console.log(res.nativeFormatted, res.nativeTicker) // "12.5 OSMO"
 * ```
 *
 * @throws if `chain` is not a vanilla bank-denom cosmos chain, `address` is
 *   empty, or both the primary LCD and Polkachu fallback fail.
 */
export async function getCosmosBalance(chain: CosmosBalanceChain, address: string): Promise<CosmosBalanceResult> {
  if (!address) throw new Error('address is required')
  const config = COSMOS_CONFIG[chain]
  if (!config) {
    throw new Error(
      `getCosmosBalance: unsupported chain ${chain}. Supported: ${Object.keys(COSMOS_CONFIG)
        .filter(c => COSMOS_CONFIG[c as CosmosBalanceChain])
        .join(', ')}`
    )
  }

  // Offline cross-chain mis-pair guard. The caller passes `chain` and
  // `address` independently, so a wrong pairing (e.g. an `osmo1...` address
  // routed to Chain.Cosmos) would silently query a FOREIGN LCD and return a
  // confidently-wrong (usually empty) balance with no signal. Fail loud on an
  // HRP mismatch BEFORE issuing the read. Note: Terra v2 + TerraClassic share
  // the `terra` HRP and cannot be distinguished offline — that same-HRP case
  // is a documented caller contract (mcp-ts disambiguates it via a live
  // chain_id LCD probe; the SDK leaves that to the caller's Chain enum).
  const hrp = bech32Hrp(address)
  if (hrp !== config.bech32Prefix) {
    throw new Error(
      `getCosmosBalance: address "${address}" has bech32 prefix "${hrp || '(none)'}" but ${chain} expects "${config.bech32Prefix}". Mis-routed address — confirm the chain matches the address.`
    )
  }

  const response = await cosmosLcdGet<BankBalancesResponse>(
    config.restUrl,
    `/cosmos/bank/v1beta1/balances/${address}`,
    config.polkachuChainKey
  )
  const asOf = new Date().toISOString()
  const raw = (response.balances ?? []).filter(b => b.amount !== '0' && b.amount !== '')

  const nativeRaw = raw.find(b => b.denom === config.denom)?.amount ?? '0'

  // Resolve held ibc/ denoms up front (parallel) so the map below can emit
  // proper symbol + decimal-scaled values for known IBC assets.
  const ibcResolved = await resolveIbcDenoms(
    chain,
    raw.filter(b => b.denom.startsWith('ibc/') && !KNOWN_DENOMS[b.denom]).map(b => b.denom)
  )

  const balances: CosmosBalanceEntry[] = raw.map(b => {
    if (b.denom === config.denom) {
      return {
        denom: b.denom,
        symbol: config.ticker,
        amount: b.amount,
        formatted: formatBalance(b.amount, config.decimals),
        decimals: config.decimals,
      }
    }
    const known = KNOWN_DENOMS[b.denom]
    if (known) {
      return {
        denom: b.denom,
        symbol: known.symbol,
        amount: b.amount,
        formatted: formatBalance(b.amount, known.decimals),
        decimals: known.decimals,
      }
    }
    if (isUnresolvedHashDenom(b.denom)) {
      const resolved = ibcResolved.get(b.denom)
      if (resolved) {
        return {
          denom: b.denom,
          symbol: resolved.symbol,
          amount: b.amount,
          formatted: formatBalance(b.amount, resolved.decimals),
          decimals: resolved.decimals,
        }
      }
      // Unresolvable: emit raw base units with an explicit caveat + null
      // decimals so downstream pricing skips it (no mis-scaling possible).
      return {
        denom: b.denom,
        symbol: `${unresolvedSymbol(b.denom)} (base units)`,
        amount: b.amount,
        formatted: b.amount,
        decimals: null,
        unresolved: true,
      }
    }
    // Plain-string non-native denom: pass through the denom as the symbol.
    return { denom: b.denom, symbol: b.denom, amount: b.amount }
  })

  return {
    chain,
    address,
    nativeFormatted: formatBalance(nativeRaw, config.decimals),
    nativeRaw,
    nativeTicker: config.ticker,
    balances,
    asOf,
  }
}

/** Chains `getCosmosBalance` can read vanilla bank-denom balances for. */
export const cosmosBalanceChains = Object.keys(COSMOS_CONFIG).filter(
  c => COSMOS_CONFIG[c as CosmosBalanceChain]
) as CosmosBalanceChain[]

/** True when `getCosmosBalance` supports this chain. */
export const isCosmosBalanceChain = (chain: Chain): chain is CosmosBalanceChain =>
  Boolean(COSMOS_CONFIG[chain as CosmosBalanceChain])
