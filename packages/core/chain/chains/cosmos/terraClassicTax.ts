/**
 * Terra Classic stability-tax queries + math.
 *
 * Background: Terra Classic (chain-id `columbus-5`) inherits the original
 * Terra "treasury" module from cosmos-sdk Terra v1, which charges a
 * stability tax on `MsgSend` / `MsgMultiSend` for every native denom
 * EXCEPT `uluna` (LUNC itself is fee-exempt). The tax is a fraction of
 * the transferred amount (governance-controlled, fixed-point 18-decimal),
 * and is capped per-denom by a separate per-denom ceiling.
 *
 * As of this lift the live `tax_rate` is `0` (governance has effectively
 * paused the tax post-UST-collapse), but the treasury module still exists
 * and the rate is queryable — historically it was 1.2% with caps that
 * mostly came into play for large `uusd` transfers. If governance ever
 * re-enables the tax, signing paths that ignore it produce txs that get
 * rejected by the chain's ante handler ("insufficient fee").
 *
 * Terra v2 (`phoenix-1`) does NOT have a treasury module — the same
 * endpoints return HTTP 501 — so callers should only invoke these for
 * `Chain.TerraClassic`.
 *
 * Consumers should query the rate AT SIGN-TIME (not cached across
 * sessions), because governance rate changes propagate immediately.
 * Within a single signing call, both `getTerraClassicTaxRate` and any
 * `getTerraClassicTaxCaps(denom)` calls are safe to memoize — the rate
 * does not change mid-tx.
 */

import { Chain } from '../../Chain'

import { cosmosRpcUrl } from './cosmosRpcUrl'

// ---------------------------------------------------------------------------
// LCD endpoints
// ---------------------------------------------------------------------------

/**
 * `cosmosRpcUrl` for Terra Classic actually points at the LCD root (despite
 * the dict name) — the same convention as `staking/lcdQueries`. Keep both
 * URL builders side-by-side here so it's obvious where the tax module
 * lives.
 *
 * Reference: terra-money/classic-core, x/treasury REST routes.
 */
export const getTerraClassicTaxRateUrl = (): string =>
  `${cosmosRpcUrl[Chain.TerraClassic]}/terra/treasury/v1beta1/tax_rate`

export const getTerraClassicTaxCapsUrl = (denom: string): string =>
  `${cosmosRpcUrl[Chain.TerraClassic]}/terra/treasury/v1beta1/tax_caps/${denom}`

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * cosmos-sdk `Dec` is fixed-point with 18 decimals — the on-the-wire
 * representation of `0.012` (1.2%) is the integer `12000000000000000`.
 * Multiplying an amount by `rate` and dividing by `DEC_SCALE` gives the
 * tax in base units of the same denom.
 */
export const TERRA_CLASSIC_TAX_DEC_SCALE = 10n ** 18n

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

type FetchOpts = { fetchImpl?: typeof fetch; signal?: AbortSignal }

async function lcdGetJson<T>(url: string, opts: FetchOpts): Promise<T> {
  const f = opts.fetchImpl ?? fetch
  const res = await f(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`LCD ${res.status}: ${url}`)
  return (await res.json()) as T
}

/**
 * Parses a cosmos-sdk `Dec` string ("0.012000000000000000") into the
 * 18-decimal fixed-point integer representation (`12000000000000000n`).
 * Accepts the integer-string form too ("12000000000000000") for callers
 * that already pre-multiplied. Throws on negative values or NaN.
 */
const parseDecToFixed18 = (s: string): bigint => {
  if (typeof s !== 'string') {
    throw new Error(`tax_rate: expected string Dec, got ${typeof s}`)
  }
  const trimmed = s.trim()
  if (trimmed.length === 0) throw new Error('tax_rate: empty Dec string')

  // Bigint-safe Dec parse: split on the decimal point if present, then
  // pad/truncate the fractional part to exactly 18 digits.
  const negative = trimmed.startsWith('-')
  if (negative) throw new Error(`tax_rate: negative Dec rejected (${trimmed})`)

  const [intPart, fracPart = ''] = trimmed.split('.')
  if (!/^[0-9]+$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) {
    throw new Error(`tax_rate: malformed Dec "${trimmed}"`)
  }
  // Truncate fractional digits beyond 18 (would overflow the Dec scale —
  // the on-chain Dec only stores 18 digits anyway, so anything past that
  // is encoder error rather than precision loss we should preserve).
  const fracTruncated = fracPart.slice(0, 18).padEnd(18, '0')
  return BigInt(intPart) * TERRA_CLASSIC_TAX_DEC_SCALE + BigInt(fracTruncated)
}

/**
 * Fetches the current Terra Classic stability tax rate as an 18-decimal
 * fixed-point bigint (e.g. `0n` if paused, `12_000_000_000_000_000n` if
 * 1.2%). Returns `0n` when the LCD response shape is missing the
 * `tax_rate` field — defensive against schema drift.
 */
export async function getTerraClassicTaxRate(
  opts: FetchOpts = {}
): Promise<bigint> {
  type Raw = { tax_rate?: string }
  const raw = await lcdGetJson<Raw>(getTerraClassicTaxRateUrl(), opts)
  if (raw.tax_rate === undefined || raw.tax_rate === null) return 0n
  return parseDecToFixed18(raw.tax_rate)
}

/**
 * Fetches the per-denom tax cap as a base-unit bigint (e.g.
 * `60_000_000_000_000_000n` for `uluna`). The cap is the maximum tax that
 * can be levied on a single transfer regardless of the rate-derived
 * amount — when the chain re-enables the tax, large `uusd` transfers in
 * particular hit the cap rather than the rate.
 *
 * Returns `null` when the LCD has no entry for the denom — caller should
 * treat this as "no per-denom cap" (the math helper interprets a missing
 * cap as `+∞`).
 */
export async function getTerraClassicTaxCap(
  denom: string,
  opts: FetchOpts = {}
): Promise<bigint | null> {
  type Raw = { tax_cap?: string }
  let raw: Raw
  try {
    raw = await lcdGetJson<Raw>(getTerraClassicTaxCapsUrl(denom), opts)
  } catch (e) {
    // Some LCDs return 404 for unknown denoms instead of an empty payload —
    // surface as `null` (no cap) rather than bubbling, since "no cap on this
    // denom" is the semantically correct interpretation.
    if (e instanceof Error && e.message.startsWith('LCD 404')) return null
    throw e
  }
  if (raw.tax_cap === undefined || raw.tax_cap === null) return null
  if (!/^[0-9]+$/.test(raw.tax_cap)) {
    throw new Error(`tax_cap: malformed bigint "${raw.tax_cap}"`)
  }
  return BigInt(raw.tax_cap)
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

/**
 * Pure helper: given a transfer `amount`, its `denom`, the current 18-decimal
 * `rate`, and a per-denom `caps` map, returns the stability tax in base
 * units of `denom`.
 *
 * Rules (mirroring x/treasury's ante handler):
 * - `denom === 'uluna'` is fee-exempt → returns `0n`.
 * - `rate === 0n` → returns `0n` (the most common case today; lets callers
 *   skip the cap fetch entirely and avoid spurious LCD load).
 * - Otherwise, `tax = floor(amount * rate / 10^18)`, then clamp to
 *   `caps[denom]` if present (cap of `null`/missing = uncapped).
 *
 * `floor` matches the cosmos-sdk Dec.MulInt rounding for positive values.
 */
export const applyTerraClassicTax = (
  amount: bigint,
  denom: string,
  rate: bigint,
  caps: Record<string, bigint | null | undefined>
): bigint => {
  if (amount < 0n) {
    throw new Error('applyTerraClassicTax: amount must be non-negative')
  }
  if (rate < 0n) {
    throw new Error('applyTerraClassicTax: rate must be non-negative')
  }
  if (denom === 'uluna') return 0n
  if (rate === 0n) return 0n

  const raw = (amount * rate) / TERRA_CLASSIC_TAX_DEC_SCALE
  const cap = caps[denom]
  if (cap === undefined || cap === null) return raw
  if (cap < 0n) {
    throw new Error(`applyTerraClassicTax: negative cap for ${denom}`)
  }
  return raw < cap ? raw : cap
}
