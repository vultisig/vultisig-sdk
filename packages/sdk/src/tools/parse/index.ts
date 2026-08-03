/**
 * tools/parse — Public-boundary argument validation (AUDIT-R3 TASK-020).
 *
 * Provides Zod schemas and safe-parse helpers for the two most common
 * string argument types the SDK's public tools accept: chain identifiers
 * and token tickers.
 *
 * ## Why this module exists
 *
 * Chain and coin string args were previously validated late — an unrecognized
 * chain string would crash deep inside `getChainKind` (record lookup returns
 * `undefined`, then `resolvers[undefined](input)` throws a TypeError). This
 * module adds a SINGLE parse boundary that consumers can call before entering
 * any SDK tool:
 *
 * ```ts
 * import { parseChain } from '@vultisig/sdk/tools/parse'
 *
 * const result = parseChain(args.chain)
 * if (!result.success) {
 *   return { error: result.error }  // clean typed error, no crash
 * }
 * // result.chain is a canonical Chain enum value — pass it to any SDK tool
 * ```
 *
 * ## Safety: fail-open design
 *
 * The Zod schemas in this module are MAXIMALLY PERMISSIVE within the set of
 * inputs the underlying normalizers accept. The goal is an early clean error
 * for genuinely-bad input (empty strings, wrong type, unknown chain), NOT
 * tightening the acceptable input set. When in doubt, accept and let the
 * downstream tool handle it.
 *
 * ## Backward compatibility
 *
 * This module is purely ADDITIVE — it does not modify any existing SDK
 * function or type. Callers that currently call `normalizeChain` or pass a
 * typed `Chain` value directly continue to work without any change. The
 * parse helpers are an opt-in boundary for callers that receive untyped
 * strings from external sources (LLM output, HTTP request bodies, CLI args).
 *
 * ## TASK-021 boundary (symbol→token)
 *
 * `tickerSchema` / `parseTicker` perform FORMAT-ONLY validation. They do NOT
 * resolve a ticker to a specific contract address or token metadata entry —
 * that is the concern of TASK-021. Keeping resolution out of this module
 * avoids the symbol→token collision landmines described in the audit.
 */
export type { ParseChainResult } from './chainSchema'
export { chainSchema, parseChain } from './chainSchema'
export type { ParseTickerResult } from './tickerSchema'
export { parseTicker, tickerSchema } from './tickerSchema'
