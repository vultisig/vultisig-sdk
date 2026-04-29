import { describe, expect, it, vi } from 'vitest'

import {
  applyTerraClassicTax,
  getTerraClassicTaxCap,
  getTerraClassicTaxCapsUrl,
  getTerraClassicTaxRate,
  getTerraClassicTaxRateUrl,
  TERRA_CLASSIC_TAX_DEC_SCALE,
} from './terraClassicTax'

// ---------------------------------------------------------------------------
// LCD response fixtures captured 2026-04-29 from
// https://terra-classic-lcd.publicnode.com/terra/treasury/v1beta1/...
// ---------------------------------------------------------------------------

const fixtureTaxRateZero = { tax_rate: '0.000000000000000000' }
// What the rate would look like if governance reactivates 1.2%.
const fixtureTaxRate12bps = { tax_rate: '0.012000000000000000' }
const fixtureTaxCapUluna = { tax_cap: '60000000000000000' }
const fixtureTaxCapUusd = { tax_cap: '82185624000000257' }

const mkFetch = (responder: (url: string) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL): Promise<Response> => {
    const u = typeof url === 'string' ? url : url.toString()
    return responder(u)
  }) as unknown as typeof fetch

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const status = (code: number): Response =>
  new Response('', { status: code })

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('Terra Classic tax LCD URLs', () => {
  it('builds the tax_rate URL against the configured LCD', () => {
    expect(getTerraClassicTaxRateUrl()).toMatch(
      /\/terra\/treasury\/v1beta1\/tax_rate$/
    )
  })

  it('builds the tax_caps URL with a denom path segment', () => {
    expect(getTerraClassicTaxCapsUrl('uusd')).toMatch(
      /\/terra\/treasury\/v1beta1\/tax_caps\/uusd$/
    )
  })
})

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

describe('getTerraClassicTaxRate', () => {
  it('returns 0n for the live "tax paused" response (current chain state 2026-04-29)', async () => {
    const fetchImpl = mkFetch(() => okJson(fixtureTaxRateZero))
    const rate = await getTerraClassicTaxRate({ fetchImpl })
    expect(rate).toBe(0n)
  })

  it('parses 1.2% as the 18-decimal Dec integer 12_000_000_000_000_000n', async () => {
    const fetchImpl = mkFetch(() => okJson(fixtureTaxRate12bps))
    const rate = await getTerraClassicTaxRate({ fetchImpl })
    expect(rate).toBe(12_000_000_000_000_000n)
  })

  it('returns 0n if the LCD response is missing the tax_rate field', async () => {
    const fetchImpl = mkFetch(() => okJson({}))
    const rate = await getTerraClassicTaxRate({ fetchImpl })
    expect(rate).toBe(0n)
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = mkFetch(() => status(503))
    await expect(getTerraClassicTaxRate({ fetchImpl })).rejects.toThrow(
      /LCD 503/
    )
  })

  it('throws on malformed Dec strings', async () => {
    const fetchImpl = mkFetch(() => okJson({ tax_rate: 'not-a-number' }))
    await expect(getTerraClassicTaxRate({ fetchImpl })).rejects.toThrow(
      /malformed Dec/
    )
  })

  it('throws on negative Dec strings', async () => {
    const fetchImpl = mkFetch(() => okJson({ tax_rate: '-0.001' }))
    await expect(getTerraClassicTaxRate({ fetchImpl })).rejects.toThrow(
      /negative Dec rejected/
    )
  })

  it('passes through abort signal', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined()
      return okJson(fixtureTaxRateZero)
    }) as unknown as typeof fetch
    const ac = new AbortController()
    await getTerraClassicTaxRate({ fetchImpl, signal: ac.signal })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('getTerraClassicTaxCap', () => {
  it('parses uluna cap from the live response', async () => {
    const fetchImpl = mkFetch(() => okJson(fixtureTaxCapUluna))
    const cap = await getTerraClassicTaxCap('uluna', { fetchImpl })
    expect(cap).toBe(60_000_000_000_000_000n)
  })

  it('parses uusd cap (a value > Number.MAX_SAFE_INTEGER, requires bigint)', async () => {
    // 82_185_624_000_000_257n — past 2^53. Verifies we don't lose precision
    // by going through a JS number anywhere in the path.
    const fetchImpl = mkFetch(() => okJson(fixtureTaxCapUusd))
    const cap = await getTerraClassicTaxCap('uusd', { fetchImpl })
    expect(cap).toBe(82_185_624_000_000_257n)
  })

  it('returns null on 404 (unknown denom — treat as uncapped)', async () => {
    const fetchImpl = mkFetch(() => status(404))
    const cap = await getTerraClassicTaxCap('umystery', { fetchImpl })
    expect(cap).toBeNull()
  })

  it('returns null when the response shape is missing tax_cap', async () => {
    const fetchImpl = mkFetch(() => okJson({}))
    const cap = await getTerraClassicTaxCap('uusd', { fetchImpl })
    expect(cap).toBeNull()
  })

  it('throws on non-404 errors', async () => {
    const fetchImpl = mkFetch(() => status(500))
    await expect(
      getTerraClassicTaxCap('uusd', { fetchImpl })
    ).rejects.toThrow(/LCD 500/)
  })

  it('throws on malformed integer strings', async () => {
    const fetchImpl = mkFetch(() => okJson({ tax_cap: '12.5' }))
    await expect(
      getTerraClassicTaxCap('uusd', { fetchImpl })
    ).rejects.toThrow(/malformed bigint/)
  })
})

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

describe('applyTerraClassicTax', () => {
  const ONE_PERCENT_TWO = 12_000_000_000_000_000n // 1.2% as 18-decimal Dec

  it('returns 0n when transferring uluna (LUNC is fee-exempt)', () => {
    expect(
      applyTerraClassicTax(1_000_000n, 'uluna', ONE_PERCENT_TWO, {})
    ).toBe(0n)
  })

  it('returns 0n when rate is 0n (current paused state)', () => {
    // The whole point of the early-zero return: callers can skip the cap
    // fetch when they already know the rate is 0.
    expect(applyTerraClassicTax(1_000_000n, 'uusd', 0n, {})).toBe(0n)
  })

  it('returns 0n when amount is 0n', () => {
    expect(applyTerraClassicTax(0n, 'uusd', ONE_PERCENT_TWO, {})).toBe(0n)
  })

  it('floors `amount * rate / 10^18` to base-unit precision', () => {
    // 1_000_000 uusd * 0.012 = 12_000 uusd. Exact, no rounding.
    expect(
      applyTerraClassicTax(1_000_000n, 'uusd', ONE_PERCENT_TWO, {})
    ).toBe(12_000n)
  })

  it('rounds DOWN (matches cosmos-sdk Dec.MulInt for positive values)', () => {
    // 100 * 0.012 = 1.2 → floor = 1n. Verifies floor semantics, not
    // round-half-even.
    expect(applyTerraClassicTax(100n, 'uusd', ONE_PERCENT_TWO, {})).toBe(1n)
  })

  it('clamps to per-denom cap when raw tax exceeds it', () => {
    // amount=10^15 uusd, rate=1.2% → raw tax 1.2 * 10^13 = 12_000_000_000_000.
    // cap=10_000_000_000_000 — clamp to cap.
    const cap = 10_000_000_000_000n
    expect(
      applyTerraClassicTax(10n ** 15n, 'uusd', ONE_PERCENT_TWO, { uusd: cap })
    ).toBe(cap)
  })

  it('does not clamp when raw tax is below the cap', () => {
    // raw tax = 12_000 (well below cap); no clamping.
    const cap = 10_000_000_000_000n
    expect(
      applyTerraClassicTax(1_000_000n, 'uusd', ONE_PERCENT_TWO, { uusd: cap })
    ).toBe(12_000n)
  })

  it('treats a missing cap as +infinity (no clamp)', () => {
    expect(
      applyTerraClassicTax(10n ** 15n, 'umystery', ONE_PERCENT_TWO, {})
    ).toBe(12n * 10n ** 12n)
  })

  it('treats a null cap as +infinity (matches getTerraClassicTaxCap returning null)', () => {
    expect(
      applyTerraClassicTax(10n ** 15n, 'umystery', ONE_PERCENT_TWO, {
        umystery: null,
      })
    ).toBe(12n * 10n ** 12n)
  })

  it('rejects negative amount', () => {
    expect(() =>
      applyTerraClassicTax(-1n, 'uusd', ONE_PERCENT_TWO, {})
    ).toThrow(/amount must be non-negative/)
  })

  it('rejects negative rate', () => {
    expect(() => applyTerraClassicTax(1n, 'uusd', -1n, {})).toThrow(
      /rate must be non-negative/
    )
  })

  it('rejects negative cap', () => {
    expect(() =>
      applyTerraClassicTax(10n ** 18n, 'uusd', ONE_PERCENT_TWO, {
        uusd: -1n,
      })
    ).toThrow(/negative cap/)
  })
})

describe('TERRA_CLASSIC_TAX_DEC_SCALE', () => {
  it('is 10^18 (cosmos-sdk Dec convention)', () => {
    expect(TERRA_CLASSIC_TAX_DEC_SCALE).toBe(1_000_000_000_000_000_000n)
  })
})
