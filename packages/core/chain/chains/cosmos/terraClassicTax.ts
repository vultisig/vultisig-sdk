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
  // URL-encode the denom: `ibc/<HASH>` and `factory/<addr>/<subdenom>` carry
  // forward-slashes that would otherwise become extra path segments and the
  // LCD would 404 (silently undertaxing those denoms once the rate is
  // nonzero).
  `${cosmosRpcUrl[Chain.TerraClassic]}/terra/treasury/v1beta1/tax_caps/${encodeURIComponent(denom)}`

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

  // Validate strict Dec shape — single decimal point at most, and
  // reject 19+ fractional digits outright. Truncating past 18 digits
  // would let `1.0000000000000000001` (semantically > 100%) parse as
  // exactly `10^18` and pass the cap guard below — fail-closed instead.
  // Codex round-1 P1.
  if (!/^[0-9]+(\.[0-9]{1,18})?$/.test(trimmed)) {
    throw new Error(
      `tax_rate: malformed Dec "${trimmed}" (expected digits with at most 18 fractional digits)`
    )
  }
  const [intPart, fracPart = ''] = trimmed.split('.')
  // intPart is guaranteed non-empty by the regex; fracPart is in [0, 18]
  // digits so no truncation is needed (it's exactly representable).
  const fracPadded = fracPart.padEnd(18, '0')
  const value =
    BigInt(intPart) * TERRA_CLASSIC_TAX_DEC_SCALE + BigInt(fracPadded)
  // Cap at 100% (Dec value `1.0` on the 18-decimal scale = `10^18`). A
  // hostile or buggy LCD returning `tax_rate: '1000.0'` would otherwise
  // drain the user — real Terra rates are < 5%.
  if (value > TERRA_CLASSIC_TAX_DEC_SCALE) {
    throw new Error(`tax_rate: rate above 100% rejected (${trimmed})`)
  }
  return value
}

/**
 * Fetches the current Terra Classic stability tax rate as an 18-decimal
 * fixed-point bigint (e.g. `0n` if paused, `12_000_000_000_000_000n` if
 * 1.2%). Throws when the LCD response is HTTP 200 but missing `tax_rate` —
 * fail-closed, because silently treating "missing" as `0n` would
 * undercalculate fees if a flaky LCD started returning `{}` after the chain
 * un-pauses the tax (causing post-sign "insufficient fee" rejections).
 */
export async function getTerraClassicTaxRate(
  opts: FetchOpts = {}
): Promise<bigint> {
  type Raw = { tax_rate?: string }
  const raw = await lcdGetJson<Raw>(getTerraClassicTaxRateUrl(), opts)
  if (raw.tax_rate === undefined || raw.tax_rate === null) {
    throw new Error('tax_rate: missing field on 200 response')
  }
  return parseDecToFixed18(raw.tax_rate)
}

/**
 * Fetches the per-denom tax cap as a base-unit bigint (e.g.
 * `60_000_000_000_000_000n` for `uluna`). The cap is the maximum tax that
 * can be levied on a single transfer regardless of the rate-derived
 * amount — when the chain re-enables the tax, large `uusd` transfers in
 * particular hit the cap rather than the rate.
 *
 * Returns `null` ONLY for HTTP 404 ("no entry for this denom") — the
 * caller treats `null` as "no per-denom cap" (the math helper interprets
 * a missing cap as `+∞`).
 *
 * Fails closed (throws) on any other shape we don't recognize — including
 * a `200` response with the `tax_cap` field missing or null. A flaky or
 * tampered LCD that drops the field would otherwise turn a capped denom
 * into an uncapped one and overcharge the user. Codex round-1 P1.
 */
export async function getTerraClassicTaxCap(
  denom: string,
  opts: FetchOpts = {}
): Promise<bigint | null> {
  type Raw = { tax_cap?: string | null }
  let raw: Raw
  try {
    raw = await lcdGetJson<Raw>(getTerraClassicTaxCapsUrl(denom), opts)
  } catch (e) {
    // 404 ⇒ "no entry for this denom" (semantically uncapped).
    if (e instanceof Error && e.message.startsWith('LCD 404')) return null
    throw e
  }
  if (raw.tax_cap === undefined || raw.tax_cap === null) {
    throw new Error(
      `tax_cap: 200 response missing tax_cap for ${denom} — refusing to fail-open and overcharge`
    )
  }
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
