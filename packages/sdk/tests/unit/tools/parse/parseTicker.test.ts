/**
 * AUDIT-R3 TASK-020: parseTicker + tickerSchema boundary tests.
 *
 * Objectives:
 *   (a) Valid ticker forms pass (real tokens from both consumers)
 *   (b) Malformed inputs return clean typed errors (not crash)
 *   (c) TASK-021 boundary: parseTicker does NOT resolve tickers to tokens
 */

import { describe, expect, it } from 'vitest'

import { parseTicker, tickerSchema } from '../../../../src/tools/parse'

// ── (a) Valid ticker forms ─────────────────────────────────────────────────────

describe('parseTicker — valid ticker forms pass', () => {
  it.each([
    // Native chain tickers (seen in both consumers)
    'BTC',
    'ETH',
    'SOL',
    'BNB',
    'AVAX',
    'DOGE',
    'LTC',
    'BCH',
    'XRP',
    'ADA',
    'DOT',
    'TRX',
    'ATOM',
    'OSMO',
    'RUNE',
    'LUNA',
    'LUNC',
    'USDC',
    'USDT',
    'CACAO',
    // Mixed-case
    'wstETH',
    'stSOL',
    'cbBTC',
    'rETH',
    // Bridged tokens with dot separator (common in Avalanche / Cosmos)
    'USD.e',
    'USDC.e',
    'BTC.b',
    'AVAX.e',
    // Lowercase is OK — format check only, not case-normalizing
    'usdc',
    'eth',
    'btc',
    // Short tickers
    'AI',
    'S',
    // Numbers allowed
    'UNI',
    'AAVE',
    '1INCH',
    // Hyphen in ticker
    'USD-T',
    // Underscore
    'USD_C',
  ])('parseTicker("%s") → success', (ticker) => {
    const result = parseTicker(ticker)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.ticker.trim()).toBe(result.ticker) // trimmed
    }
  })

  it('trims surrounding whitespace from valid tickers', () => {
    const result = parseTicker('  ETH  ')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.ticker).toBe('ETH')
    }
  })
})

// ── (b) Malformed inputs return clean typed errors ────────────────────────────

describe('parseTicker — malformed inputs return typed errors (not crash)', () => {
  it('parseTicker("") → failure (empty)', () => {
    const result = parseTicker('')
    expect(result.success).toBe(false)
  })

  it('parseTicker("   ") → failure (whitespace only)', () => {
    const result = parseTicker('   ')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/empty|blank/i)
    }
  })

  it('parseTicker(null) → failure (null input)', () => {
    const result = parseTicker(null)
    expect(result.success).toBe(false)
  })

  it('parseTicker(undefined) → failure (undefined input)', () => {
    const result = parseTicker(undefined)
    expect(result.success).toBe(false)
  })

  it('parseTicker("a too long ticker symbol ABCDEFGHIJKLMN") → failure (too long)', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTU' // 21 chars > MAX_TICKER_LENGTH=20
    const result = parseTicker(long)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/too long/i)
    }
  })

  it.each([
    'USD COIN',     // space inside
    'ETH/BTC',     // slash
    'ETH@2',       // @
    '$USDC',       // leading dollar
    '<TICKER>',    // angle bracket
    'USDC:Ethereum', // colon
    'token name',  // space
    'sol!',        // exclamation
  ])('parseTicker("%s") → failure (invalid chars)', (ticker) => {
    const result = parseTicker(ticker)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('does NOT throw — returns error union instead of crash', () => {
    expect(() => parseTicker('')).not.toThrow()
    expect(() => parseTicker(null)).not.toThrow()
    expect(() => parseTicker(undefined)).not.toThrow()
    expect(() => parseTicker('$bad!')).not.toThrow()
  })
})

// ── (c) TASK-021 boundary — no resolution to tokens ──────────────────────────

describe('parseTicker — TASK-021 boundary: format-only, no token resolution', () => {
  it('parseTicker("USDC") succeeds on format check without knowing the chain', () => {
    // USDC exists on many chains. parseTicker must NOT pick one silently.
    const result = parseTicker('USDC')
    expect(result.success).toBe(true)
    if (result.success) {
      // Returns the trimmed string only — no chain, no contract address
      expect(result.ticker).toBe('USDC')
      expect(result).not.toHaveProperty('chain')
      expect(result).not.toHaveProperty('contractAddress')
      expect(result).not.toHaveProperty('id')
    }
  })

  it('parseTicker("ETH") succeeds without resolving to a specific chain', () => {
    const result = parseTicker('ETH')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.ticker).toBe('ETH')
      expect(result).not.toHaveProperty('chain')
    }
  })
})

// ── tickerSchema Zod API ───────────────────────────────────────────────────────

describe('tickerSchema — Zod schema API', () => {
  it('tickerSchema.safeParse("USDC") → success', () => {
    const result = tickerSchema.safeParse('USDC')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('USDC')
    }
  })

  it('tickerSchema.safeParse("") → failure', () => {
    const result = tickerSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('tickerSchema.safeParse("wstETH") → success (multi-char mixed-case)', () => {
    const result = tickerSchema.safeParse('wstETH')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('wstETH')
    }
  })

  it('tickerSchema.safeParse("  ETH  ") → success (trimmed)', () => {
    const result = tickerSchema.safeParse('  ETH  ')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('ETH')
    }
  })
})
