import { z } from 'zod'
import type { Chain } from '@vultisig/core-chain/Chain'

import { normalizeChain, UnknownChainError } from '../../utils/normalizeChain'

/**
 * Zod schema that normalizes a chain string to the canonical `Chain` value.
 *
 * Accepts every form that `normalizeChain` accepts:
 * - Canonical Chain enum values (`"Ethereum"`, `"TerraClassic"`, `"Bitcoin-Cash"`, …)
 * - Case-insensitive tickers (`"btc"`, `"eth"`, `"sol"`, …)
 * - Common aliases (`"binance"`, `"thor"`, …)
 * - Space/underscore/hyphen-insensitive natural-language phrasings
 *   (`"Terra Classic"`, `"Bitcoin Cash"`, `"THOR Chain"`, …)
 * - Chain-id and marketing-name aliases (`"columbus-5"`, `"phoenix-1"`, `"Terra V2"`)
 * - null / undefined → UnknownChainError (same as `normalizeChain`)
 *
 * On unrecognized input the schema returns a Zod `ZodError` with the same
 * descriptive message that `UnknownChainError` would have thrown — the caller
 * gets a typed error at the parse boundary instead of a late crash inside
 * `getChainKind` / `resolvers[undefined]`.
 *
 * Design — fail-open safety: this schema is intentionally AS PERMISSIVE as
 * `normalizeChain`. If you are unsure whether an input form is valid, ACCEPT
 * it (let the normalizer decide) rather than adding a pre-filter. The goal is
 * an early clean error for genuinely-bad input, not tightening the acceptable
 * set. Any form already accepted by `normalizeChain` must continue to pass
 * through this schema unchanged.
 */
export const chainSchema: z.ZodType<Chain> = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val, ctx): Chain => {
    try {
      return normalizeChain(val)
    } catch (err) {
      const message =
        err instanceof UnknownChainError
          ? err.message
          : `Unknown chain '${val == null ? String(val) : val}'.`
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        params: { code: 'unknown_chain' },
      })
      return z.NEVER
    }
  }) as z.ZodType<Chain>

/**
 * Result of `parseChain`.
 * A discriminated union — check `success` before accessing `chain` or `error`.
 */
export type ParseChainResult =
  | { success: true; chain: Chain }
  | { success: false; error: string; input: string | null | undefined }

/**
 * Safe-parse a chain string without throwing.
 *
 * ```ts
 * const result = parseChain(args.chain)
 * if (!result.success) {
 *   return jsonError({ error: 'unknown_chain', message: result.error })
 * }
 * // result.chain is a canonical Chain value
 * ```
 *
 * Equivalent to calling `normalizeChain(input)` inside a try/catch but
 * returns a typed discriminated union instead of relying on exception handling.
 *
 * The happy path is byte-identical to calling `normalizeChain` directly —
 * the canonical `Chain` value produced is the same object the old throwing
 * path would have returned.
 */
export function parseChain(input: string | null | undefined): ParseChainResult {
  const result = chainSchema.safeParse(input)
  if (result.success) {
    return { success: true, chain: result.data }
  }
  const first = result.error.issues[0]
  return {
    success: false,
    error: first?.message ?? `Unknown chain '${String(input)}'.`,
    input,
  }
}
