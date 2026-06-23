/**
 * `sdk.defi.*` — DeFi protocol message builders.
 *
 * Each protocol lives under its own namespace (`defi.osmosis`, ...). Builders
 * produce UNSIGNED calldata / Cosmos msgs only — never sign, never broadcast.
 * Part of the sdk.defi.* DeFi consolidation (porting the mcp-ts DeFi tools into
 * a reusable, multi-consumer SDK surface).
 */
export * as osmosis from './osmosis'
