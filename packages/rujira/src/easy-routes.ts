/**
 * Easy Swap Routes - Simple DeFi for Agents & Humans
 * 
 * These routes are battle-tested with deep liquidity.
 * Pick a route, get a quote, swap. That's it.
 * 
 * @example
 * ```typescript
 * import { EASY_ROUTES, getEasyQuote } from '@vultisig/rujira';
 * 
 * // One-liner quote
 * const quote = await getEasyQuote('RUNE_TO_USDC', '100');
 * console.log(`100 RUNE → ${quote.expectedOutput} USDC`);
 * ```
 * 
 * @module easy-routes
 */

// ============================================================================
// EASY ROUTES
// ============================================================================

/**
 * Pre-configured swap routes with deep liquidity.
 * All routes go through RUNE as the settlement asset.
 * 
 * Asset format: On-chain denoms (lowercase, hyphen-separated)
 * - Native L1: btc-btc, eth-eth
 * - THORChain: rune, tcy, ruji
 * - Secured (ERC20): eth-usdc-0xa0b86991..., eth-usdt-0xdac17f958d...
 */
export const EASY_ROUTES = {
  // === RUNE Gateway Routes ===
  RUNE_TO_USDC: {
    from: 'rune',
    to: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'RUNE → USDC',
    description: 'Swap RUNE to USDC (Ethereum)',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  USDC_TO_RUNE: {
    from: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    to: 'rune',
    name: 'USDC → RUNE',
    description: 'Swap USDC to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  RUNE_TO_BTC: {
    from: 'rune',
    to: 'btc-btc',
    name: 'RUNE → BTC',
    description: 'Swap RUNE to native Bitcoin',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  BTC_TO_RUNE: {
    from: 'btc-btc',
    to: 'rune',
    name: 'BTC → RUNE',
    description: 'Swap native Bitcoin to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  RUNE_TO_ETH: {
    from: 'rune',
    to: 'eth-eth',
    name: 'RUNE → ETH',
    description: 'Swap RUNE to native Ethereum',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  ETH_TO_RUNE: {
    from: 'eth-eth',
    to: 'rune',
    name: 'ETH → RUNE',
    description: 'Swap native Ethereum to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },

  // === Stablecoin Routes ===
  USDC_TO_USDT: {
    from: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    to: 'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7',
    name: 'USDC → USDT',
    description: 'Swap USDC to USDT (via RUNE)',
    liquidity: 'deep' as const,
    typicalTime: '15-45 seconds',
  },
  USDT_TO_USDC: {
    from: 'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7',
    to: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'USDT → USDC',
    description: 'Swap USDT to USDC (via RUNE)',
    liquidity: 'deep' as const,
    typicalTime: '15-45 seconds',
  },

  // === BTC-Stable Routes ===
  BTC_TO_USDC: {
    from: 'btc-btc',
    to: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'BTC → USDC',
    description: 'Swap native Bitcoin to USDC',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  USDC_TO_BTC: {
    from: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    to: 'btc-btc',
    name: 'USDC → BTC',
    description: 'Swap USDC to native Bitcoin',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },

  // === ETH-Stable Routes ===
  ETH_TO_USDC: {
    from: 'eth-eth',
    to: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'ETH → USDC',
    description: 'Swap ETH to USDC',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  USDC_TO_ETH: {
    from: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    to: 'eth-eth',
    name: 'USDC → ETH',
    description: 'Swap USDC to ETH',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },

  // === Cross-Chain Routes ===
  BTC_TO_ETH: {
    from: 'btc-btc',
    to: 'eth-eth',
    name: 'BTC → ETH',
    description: 'Swap native Bitcoin to native Ethereum',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  ETH_TO_BTC: {
    from: 'eth-eth',
    to: 'btc-btc',
    name: 'ETH → BTC',
    description: 'Swap native Ethereum to native Bitcoin',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
} as const;

export type EasyRouteName = keyof typeof EASY_ROUTES;
export type EasyRoute = (typeof EASY_ROUTES)[EasyRouteName];

// ============================================================================
// COMMON ASSETS (shortcuts)
// ============================================================================

/**
 * Common asset denoms - use these to avoid typos
 * All denoms are lowercase, hyphen-separated (on-chain format)
 */
export const ASSETS = {
  // Native chain assets
  RUNE: 'rune',
  BTC: 'btc-btc',
  ETH: 'eth-eth',
  AVAX: 'avax-avax',
  ATOM: 'gaia-atom',
  DOGE: 'doge-doge',
  LTC: 'ltc-ltc',
  BCH: 'bch-bch',
  BNB: 'bsc-bnb',

  // Stablecoins (Ethereum)
  USDC: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  USDT: 'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7',

  // Rujira native tokens
  RUJI: 'ruji',
  TCY: 'tcy',
} as const;

export type AssetName = keyof typeof ASSETS;
export type Asset = (typeof ASSETS)[AssetName];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * List all available easy routes
 * Perfect for agents to discover swap options
 */
export function listEasyRoutes(): Array<{
  id: EasyRouteName;
  name: string;
  from: string;
  to: string;
  description: string;
  liquidity: string;
  typicalTime: string;
}> {
  return Object.entries(EASY_ROUTES).map(([id, route]) => ({
    id: id as EasyRouteName,
    name: route.name,
    from: route.from,
    to: route.to,
    description: route.description,
    liquidity: route.liquidity,
    typicalTime: route.typicalTime,
  }));
}

/**
 * Get a route by name
 */
export function getRoute(routeName: EasyRouteName): EasyRoute {
  return EASY_ROUTES[routeName];
}

/**
 * Find routes for a given asset pair
 */
export function findRoute(from: string, to: string): EasyRoute | undefined {
  const normalizedFrom = from.toLowerCase();
  const normalizedTo = to.toLowerCase();

  for (const route of Object.values(EASY_ROUTES)) {
    if (route.from === normalizedFrom && route.to === normalizedTo) {
      return route;
    }
  }
  return undefined;
}

/**
 * Get routes that involve a specific asset
 */
export function routesForAsset(asset: string): EasyRoute[] {
  const normalized = asset.toLowerCase();
  return Object.values(EASY_ROUTES).filter(
    (route) => route.from === normalized || route.to === normalized
  );
}

/**
 * Get all routes from a specific asset
 */
export function routesFrom(asset: string): EasyRoute[] {
  const normalized = asset.toLowerCase();
  return Object.values(EASY_ROUTES).filter(
    (route) => route.from === normalized
  );
}

/**
 * Get all routes to a specific asset
 */
export function routesTo(asset: string): EasyRoute[] {
  const normalized = asset.toLowerCase();
  return Object.values(EASY_ROUTES).filter(
    (route) => route.to === normalized
  );
}

// ============================================================================
// CONVENIENCE TYPES FOR AGENTS
// ============================================================================

/**
 * Simple swap request - all an agent needs
 */
export interface EasySwapRequest {
  /** Route name (e.g., 'RUNE_TO_USDC') or custom from/to */
  route?: EasyRouteName;
  from?: string;
  to?: string;
  /** Amount to swap (human readable, e.g., '100' for 100 RUNE) */
  amount: string;
  /** Destination address */
  destination: string;
  /** Max slippage in percent (default: 1%) */
  maxSlippagePercent?: number;
}

/**
 * Simple quote response
 */
export interface EasyQuoteResponse {
  /** Input amount (human readable) */
  inputAmount: string;
  /** Input asset */
  inputAsset: string;
  /** Expected output (human readable) */
  expectedOutput: string;
  /** Output asset */
  outputAsset: string;
  /** Slippage in percent */
  slippagePercent: number;
  /** Estimated time */
  estimatedTime: string;
  /** Fees breakdown */
  fees: {
    network: string;
    affiliate: string;
  };
  /** Is this a good trade? (slippage < 2%) */
  recommended: boolean;
  /** Warning message if any */
  warning?: string;
}

// ============================================================================
// DOCUMENTATION HELPERS
// ============================================================================

/**
 * Get a human-readable summary of all routes
 * Useful for displaying to users or agents
 */
export function getRoutesSummary(): string {
  const lines = [
    '# Easy Swap Routes',
    '',
    'Battle-tested routes with deep liquidity:',
    '',
    '| Route | From | To | Time |',
    '|-------|------|-----|------|',
  ];

  for (const [id, route] of Object.entries(EASY_ROUTES)) {
    // Extract readable name from denom
    const fromShort = denomToTicker(route.from);
    const toShort = denomToTicker(route.to);
    lines.push(`| ${id} | ${fromShort} | ${toShort} | ${route.typicalTime} |`);
  }

  lines.push('', '## Quick Start', '');
  lines.push('```typescript');
  lines.push("import { EASY_ROUTES, RujiraClient } from '@vultisig/rujira';");
  lines.push('');
  lines.push("const client = new RujiraClient({ network: 'mainnet' });");
  lines.push('const route = EASY_ROUTES.RUNE_TO_USDC;');
  lines.push('');
  lines.push('const quote = await client.swap.getQuote({');
  lines.push('  fromAsset: route.from,');
  lines.push('  toAsset: route.to,');
  lines.push("  amount: '10000000000' // 100 RUNE (8 decimals)");
  lines.push('});');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Convert denom to short ticker for display
 * e.g., 'btc-btc' -> 'BTC', 'eth-usdc-0x...' -> 'USDC'
 */
function denomToTicker(denom: string): string {
  if (denom === 'rune') return 'RUNE';
  if (denom === 'tcy') return 'TCY';
  if (denom === 'ruji') return 'RUJI';
  
  // Handle chain-asset format: btc-btc -> BTC, eth-usdc-0x... -> USDC
  const parts = denom.split('-');
  if (parts.length >= 2) {
    return parts[1].toUpperCase().split('-')[0]; // Get second part, remove contract addr
  }
  
  return denom.toUpperCase();
}
