/**
 * CoinGecko coin-ID map for native / well-known tokens.
 *
 * Ported from mcp-ts `coin-gecko-id-map.ts` as part of the
 * mcp-ts/backend → SDK code-as-action consolidation. Pure data table — no
 * agent/LLM concepts. The price oracle (`fetchPriceQuote`) uses this to map a
 * ticker symbol the caller passes (ETH, BTC, USDC, ...) to a stable CoinGecko
 * coin ID for the `/simple/price` endpoint.
 *
 * Map semantics:
 * - Keys are UPPERCASE ticker symbols.
 * - Values are CoinGecko coin IDs (stable, slug-format).
 * - A symbol MUST only be added here if CoinGecko actually returns a price
 *   for it via the `/simple/price` endpoint.
 *
 * Alias rules when two symbols share one CoinGecko ID:
 * - Both aliases belong here so both resolve correctly.
 * - The reverse lookup (`coinGeckoIdToSymbol`) pins the canonical winner.
 */
export const NATIVE_COINGECKO_IDS: Readonly<Record<string, string>> = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
  XRP: 'ripple',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  POL: 'matic-network',
  AVAX: 'avalanche-2',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  DASH: 'dash',
  ZEC: 'zcash',
  RUNE: 'thorchain',
  MNT: 'mantle',
  SUI: 'sui',
  TON: 'the-open-network',
  ADA: 'cardano',
  TRX: 'tron',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ATOM: 'cosmos',
  OSMO: 'osmosis',
  KUJI: 'kujira',
  CACAO: 'cacao',
  DOT: 'polkadot',
  // Terra v2 (phoenix-1) and Terra Classic (columbus-5) share the bech32
  // prefix `terra` but are distinct assets on CoinGecko. Pin both to avoid the
  // symbol-search fallback pulling the wrong-asset price.
  LUNA: 'terra-luna-2',
  LUNA2: 'terra-luna-2',
  LUNC: 'terra-luna',
  USTC: 'terrausd',
  UST: 'terrausd',
  HYPE: 'hyperliquid',
  CRO: 'crypto-com-chain',
  SEI: 'sei-network',
  AKT: 'akash-network',
  DYDX: 'dydx-chain',
  // TCY is denominated in RUNE on THORChain; reuse the THORChain price as a
  // rough proxy.
  TCY: 'thorchain',
  TRUMP: 'official-trump',
  PI: 'pi-network',
  HEX: 'hex',
  VULT: 'vultisig',
  MAYA: 'maya-protocol',
  RUJI: 'rujira',
}

/**
 * Reverse-lookup map: CoinGecko coin ID → canonical ticker symbol.
 *
 * Built from the forward map with explicit overrides for collisions where two
 * symbols share one CoinGecko ID (LUNA/LUNA2 → "terra-luna-2"; USTC/UST →
 * "terrausd"). Without the overrides, iteration order lets the last-defined
 * alias win, reversing to the wrong canonical ticker.
 */
export const coinGeckoIdToSymbol: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(NATIVE_COINGECKO_IDS).map(([symbol, cgId]) => [cgId, symbol])),
  'terra-luna-2': 'LUNA',
  terrausd: 'USTC',
}

/** True when `symbol` (case-insensitive) is a known native price symbol. */
export const isKnownNativePriceSymbol = (symbol: string): boolean =>
  NATIVE_COINGECKO_IDS[symbol.toUpperCase()] !== undefined

/**
 * If `token` is a CoinGecko coin ID that maps to a known symbol (e.g.
 * "terra-luna-2" → "LUNA"), return the canonical ticker. Returns undefined
 * when the input is not a recognised CoinGecko ID.
 */
export const symbolFromCoinGeckoId = (token: string): string | undefined => coinGeckoIdToSymbol[token.toLowerCase()]
