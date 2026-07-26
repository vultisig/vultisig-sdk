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

import { attempt } from '@vultisig/lib-utils/attempt'

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

/**
 * The `x/tax` module params, which carry `burn_tax_rate` — a DIFFERENT tax
 * from the `x/treasury` `tax_rate` above, and the one that is actually live.
 *
 * | module       | field           | live value | exempts uluna? |
 * |--------------|-----------------|------------|----------------|
 * | `x/treasury` | `tax_rate`      | 0          | yes            |
 * | `x/tax`      | `burn_tax_rate` | 0.005      | NO             |
 *
 * The treasury stability tax has been paused by governance since the UST
 * collapse; the burn tax replaced it and applies to `uluna` transfers too —
 * burning LUNC is its entire purpose. Reading the treasury endpoint for a
 * LUNC send therefore always yields 0 and undercharges the fee.
 *
 * Same endpoint iOS (`CosmosAPI.terraClassicTaxParams`) and Android read.
 */
export const getTerraClassicBurnTaxParamsUrl = (): string =>
  `${cosmosRpcUrl[Chain.TerraClassic]}/terra/tax/v1beta1/params`

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

/**
 * Conservative fallback burn-tax rate (0.5%) used when the live `x/tax`
 * params can't be fetched or parsed. Failing CLOSED (taxing) rather than open
 * (0%) avoids signing a tx the chain then rejects at broadcast — an overpaid
 * fee is recoverable, a rejected transfer wastes the gas and moves nothing.
 *
 * Mirrors iOS / Android `TerraClassicTax.fallbackBurnTaxRate`.
 */
export const TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE = 5_000_000_000_000_000n // 0.005

/**
 * Sanity ceiling (10%) for a parsed burn-tax rate. The rate is
 * governance-controlled and has historically been ≤ 1.2%, so anything above
 * this is treated as garbage — a malformed `"5"` meaning 500% would otherwise
 * be applied literally and drain the account into the fee. Keeps the fail-safe
 * symmetric with the lower bound, so a bad endpoint can neither under- nor
 * massively over-charge. Mirrors iOS / Android `maxBurnTaxRate`.
 */
export const TERRA_CLASSIC_MAX_BURN_TAX_RATE = 100_000_000_000_000_000n // 0.1

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
    throw new Error(`tax_rate: malformed Dec "${trimmed}" (expected digits with at most 18 fractional digits)`)
  }
  const [intPart, fracPart = ''] = trimmed.split('.')
  // intPart is guaranteed non-empty by the regex; fracPart is in [0, 18]
  // digits so no truncation is needed (it's exactly representable).
  const fracPadded = fracPart.padEnd(18, '0')
  const value = BigInt(intPart) * TERRA_CLASSIC_TAX_DEC_SCALE + BigInt(fracPadded)
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
export async function getTerraClassicTaxRate(opts: FetchOpts = {}): Promise<bigint> {
  type Raw = { tax_rate?: string }
  const raw = await lcdGetJson<Raw>(getTerraClassicTaxRateUrl(), opts)
  if (raw.tax_rate === undefined || raw.tax_rate === null) {
    throw new Error('tax_rate: missing field on 200 response')
  }
  return parseDecToFixed18(raw.tax_rate)
}

/**
 * Parses an `x/tax` `burn_tax_rate` Dec string into an 18-decimal fixed-point
 * bigint, falling back to {@link TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE} on a
 * missing, malformed, negative, or implausibly large value.
 *
 * Never throws. Unlike the treasury `tax_rate` — where a missing field means
 * "the LCD is broken, refuse to guess" — a missing burn rate has a known-safe
 * answer (the current governance rate), and the initiator is the only device
 * that computes this. Mirrors iOS / Android `TerraClassicTax.parseRate`.
 */
export const parseTerraClassicBurnTaxRate = (raw: string | null | undefined): bigint => {
  if (raw === null || raw === undefined) return TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE

  const parsed = attempt(() => parseDecToFixed18(raw))
  if ('error' in parsed) return TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE

  return parsed.data > TERRA_CLASSIC_MAX_BURN_TAX_RATE ? TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE : parsed.data
}

/**
 * Fetches the live `x/tax` burn-tax rate as an 18-decimal fixed-point bigint
 * (`5_000_000_000_000_000n` for the current 0.5%).
 *
 * Fails closed to {@link TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE} on any LCD
 * error, so a network blip produces a slightly overpaid fee rather than a tx
 * the ante handler rejects.
 */
export async function getTerraClassicBurnTaxRate(opts: FetchOpts = {}): Promise<bigint> {
  type Raw = { params?: { burn_tax_rate?: string } }

  const result = await attempt(() => lcdGetJson<Raw>(getTerraClassicBurnTaxParamsUrl(), opts))
  if ('error' in result) return TERRA_CLASSIC_FALLBACK_BURN_TAX_RATE

  return parseTerraClassicBurnTaxRate(result.data.params?.burn_tax_rate)
}

/**
 * Burn tax on a `amount` of the send denom, at an 18-decimal fixed-point
 * `rate`, rounded UP so the signed fee never lands a base unit below the
 * chain's check.
 *
 * Deliberately NOT {@link applyTerraClassicTax}: that models the treasury
 * stability tax, which exempts `uluna` and applies per-denom caps. The burn
 * tax exempts nothing and is uncapped — feeding a LUNC send through the
 * treasury helper silently returns `0n`.
 *
 * Mirrors iOS / Android `TerraClassicTax.burnTax` (both round up).
 */
export const applyTerraClassicBurnTax = (amount: bigint, rate: bigint): bigint => {
  if (amount <= 0n || rate <= 0n) return 0n

  return (amount * rate + TERRA_CLASSIC_TAX_DEC_SCALE - 1n) / TERRA_CLASSIC_TAX_DEC_SCALE
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
export async function getTerraClassicTaxCap(denom: string, opts: FetchOpts = {}): Promise<bigint | null> {
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
    throw new Error(`tax_cap: 200 response missing tax_cap for ${denom} — refusing to fail-open and overcharge`)
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
