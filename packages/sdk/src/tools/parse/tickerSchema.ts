import { z } from 'zod'

/**
 * Maximum reasonable length for a token ticker / symbol string.
 * Real-world tickers top out around 12–14 chars (e.g. `stSOL`, `wstETH`,
 * `BITCOIN.b`). 20 chars gives comfortable headroom without accepting garbage.
 */
const MAX_TICKER_LENGTH = 20

/**
 * Accepted characters in a token ticker:
 * - ASCII letters (a–z, A–Z)
 * - ASCII digits (0–9)
 * - Dot `.`  — used in bridged assets (`USDC.e`, `BTC.b`, `AVAX.e`)
 * - Hyphen `-` — used in some wrapped tokens
 * - Underscore `_` — used in some DeFi token names
 *
 * This is intentionally PERMISSIVE. If you are unsure whether a ticker form
 * is valid, accept it and let the downstream token resolver handle it.
 * The goal is catching clearly garbage input (empty, paragraph-length text,
 * control characters) at the parse boundary — not second-guessing the
 * token registry.
 *
 * NOTE (TASK-021 boundary): this schema does NOT resolve a ticker to a
 * specific token or contract address. Doing so here would create the
 * symbol→token collision risk documented in AUDIT-R3 TASK-021. Keep
 * resolution out of this module.
 */
const TICKER_RE = /^[a-zA-Z0-9._-]+$/

/**
 * Zod schema for a raw token ticker / symbol string.
 *
 * Performs format-only validation — it does NOT look up the ticker in
 * `knownTokens` or any external registry (see TASK-021 for that path).
 *
 * Accepts:
 * - `"BTC"`, `"ETH"`, `"USDC"`, `"wstETH"`, `"USD.e"`, `"BTC.b"`, `"stSOL"`
 *
 * Rejects:
 * - Empty / whitespace-only strings
 * - Strings longer than `MAX_TICKER_LENGTH` characters
 * - Strings containing spaces, angle brackets, slashes, or other non-ticker chars
 *
 * The schema trims leading/trailing whitespace before validation so that
 * `"  ETH  "` is treated identically to `"ETH"` (common LLM output artifact).
 */
export const tickerSchema: z.ZodType<string> = z
  .string()
  .transform((val, ctx): string => {
    const trimmed = val.trim()

    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ticker is required (got empty or whitespace-only string).',
        params: { code: 'blank_ticker' },
      })
      return z.NEVER
    }

    if (trimmed.length > MAX_TICKER_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `ticker '${trimmed.slice(0, 30)}…' is too long (${trimmed.length} chars); ` +
          `expected a token symbol like "BTC", "USDC", or "wstETH" (max ${MAX_TICKER_LENGTH} chars).`,
        params: { code: 'ticker_too_long' },
      })
      return z.NEVER
    }

    if (!TICKER_RE.test(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `ticker '${trimmed}' contains invalid characters. ` +
          `Expected a token symbol like "BTC", "USDC", "wstETH", or "USD.e" ` +
          `(letters, digits, dots, hyphens, underscores only).`,
        params: { code: 'invalid_ticker_chars' },
      })
      return z.NEVER
    }

    return trimmed
  })

/**
 * Result of `parseTicker`.
 * A discriminated union — check `success` before accessing `ticker` or `error`.
 */
export type ParseTickerResult =
  | { success: true; ticker: string }
  | { success: false; error: string; input: string | null | undefined }

/**
 * Safe-parse a ticker string without throwing.
 *
 * ```ts
 * const result = parseTicker(args.ticker)
 * if (!result.success) {
 *   return jsonError({ error: 'invalid_ticker', message: result.error })
 * }
 * // result.ticker is a trimmed, format-validated ticker string
 * ```
 *
 * This is a FORMAT-ONLY check. The returned `ticker` string has not been
 * resolved against any token registry — see `getTokenMetadata` / `searchToken`
 * for resolution, keeping the symbol→token collision concern in a single place
 * (AUDIT-R3 TASK-021 boundary).
 */
export function parseTicker(input: string | null | undefined): ParseTickerResult {
  if (input == null) {
    return {
      success: false,
      error: 'ticker is required (got null or undefined).',
      input,
    }
  }
  const result = tickerSchema.safeParse(input)
  if (result.success) {
    return { success: true, ticker: result.data }
  }
  const first = result.error.issues[0]
  return {
    success: false,
    error: first?.message ?? `Invalid ticker '${input}'.`,
    input,
  }
}
