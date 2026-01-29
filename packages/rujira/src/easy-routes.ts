/**
 * Easy Swap Routes - Simplified DeFi interface for AI agents and human developers
 * 
 * Easy routes abstract away the complexity of asset discovery and pair matching
 * by providing pre-configured, battle-tested trading routes. These routes are
 * specifically designed for high-frequency use cases like trading bots and AI agents.
 * 
 * Why easy routes exist:
 * - **Simplicity**: No need to understand THORChain's asset format complexities
 * - **Reliability**: All routes have been tested and have consistent liquidity
 * - **Performance**: Routes are optimized for common trading patterns
 * - **AI-friendly**: Predictable interfaces that work well with language models
 * 
 * Route design principles:
 * - All cross-chain routes settle through RUNE (THORChain's native token)
 * - Asset identifiers use on-chain denoms (lowercase, hyphen-separated)
 * - Time estimates include L1 confirmation delays for realistic expectations
 * - Liquidity ratings reflect actual market depth and trading volume
 * 
 * Usage patterns:
 * 1. **Quick swaps**: Pick a route, provide amount and destination, execute
 * 2. **Price comparison**: Get quotes for multiple routes and pick the best
 * 3. **Market analysis**: Use batch quote functions to analyze all available options
 * 4. **Cross-chain bridging**: Use L1 memo generation for external chain deposits
 * 
 * @example
 * ```typescript
 * import { EASY_ROUTES, RujiraClient } from '@vultisig/rujira';
 * 
 * const client = new RujiraClient({ network: 'mainnet' });
 * await client.connect();
 * 
 * // Simple route execution
 * const result = await client.swap.easySwap({
 *   route: 'RUNE_TO_USDC',
 *   amount: '100000000', // 1 RUNE (8 decimals)
 *   destination: 'thor1...',
 *   maxSlippagePercent: 1
 * });
 * 
 * // Compare multiple routes
 * const quotes = await client.swap.batchGetQuotes(
 *   ['RUNE_TO_USDC', 'RUNE_TO_BTC', 'RUNE_TO_ETH'],
 *   '100000000'
 * );
 * ```
 * 
 * @module easy-routes
 */

import { KNOWN_ASSETS, type Asset } from '@vultisig/assets';

// Helper to safely get asset format (throws if asset not found)
function getFinFormat(assetId: string): string {
  const asset = KNOWN_ASSETS[assetId as keyof typeof KNOWN_ASSETS];
  if (!asset) {
    throw new Error(`Unknown asset: ${assetId}`);
  }
  return asset.formats.fin;
}

// ============================================================================
// EASY ROUTES
// ============================================================================

/**
 * Pre-configured swap routes with deep liquidity.
 * All routes go through RUNE as the settlement asset.
 * 
 * Asset format: On-chain denoms (lowercase, hyphen-separated)
 * Uses @vultisig/assets for unified asset handling
 */
export const EASY_ROUTES = {
  // === RUNE Gateway Routes ===
  RUNE_TO_USDC: {
    from: getFinFormat('rune'),
    to: getFinFormat('usdc_eth'),
    name: 'RUNE → USDC',
    description: 'Swap RUNE to USDC (Ethereum)',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  USDC_TO_RUNE: {
    from: getFinFormat('usdc_eth'),
    to: getFinFormat('rune'),
    name: 'USDC → RUNE',
    description: 'Swap USDC to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  RUNE_TO_BTC: {
    from: getFinFormat('rune'),
    to: getFinFormat('btc'),
    name: 'RUNE → BTC',
    description: 'Swap RUNE to native Bitcoin',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  BTC_TO_RUNE: {
    from: getFinFormat('btc'),
    to: getFinFormat('rune'),
    name: 'BTC → RUNE',
    description: 'Swap native Bitcoin to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  RUNE_TO_ETH: {
    from: getFinFormat('rune'),
    to: getFinFormat('eth'),
    name: 'RUNE → ETH',
    description: 'Swap RUNE to native Ethereum',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  ETH_TO_RUNE: {
    from: getFinFormat('eth'),
    to: getFinFormat('rune'),
    name: 'ETH → RUNE',
    description: 'Swap native Ethereum to RUNE',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },

  // === Stablecoin Routes ===
  USDC_TO_USDT: {
    from: getFinFormat('usdc_eth'),
    to: getFinFormat('usdt_eth'),
    name: 'USDC → USDT',
    description: 'Swap USDC to USDT (via RUNE)',
    liquidity: 'deep' as const,
    typicalTime: '15-45 seconds',
  },
  USDT_TO_USDC: {
    from: getFinFormat('usdt_eth'),
    to: getFinFormat('usdc_eth'),
    name: 'USDT → USDC',
    description: 'Swap USDT to USDC (via RUNE)',
    liquidity: 'deep' as const,
    typicalTime: '15-45 seconds',
  },

  // === BTC-Stable Routes ===
  BTC_TO_USDC: {
    from: getFinFormat('btc'),
    to: getFinFormat('usdc_eth'),
    name: 'BTC → USDC',
    description: 'Swap native Bitcoin to USDC',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  USDC_TO_BTC: {
    from: getFinFormat('usdc_eth'),
    to: getFinFormat('btc'),
    name: 'USDC → BTC',
    description: 'Swap USDC to native Bitcoin',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },

  // === ETH-Stable Routes ===
  ETH_TO_USDC: {
    from: getFinFormat('eth'),
    to: getFinFormat('usdc_eth'),
    name: 'ETH → USDC',
    description: 'Swap ETH to USDC',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },
  USDC_TO_ETH: {
    from: getFinFormat('usdc_eth'),
    to: getFinFormat('eth'),
    name: 'USDC → ETH',
    description: 'Swap USDC to ETH',
    liquidity: 'deep' as const,
    typicalTime: '10-30 seconds',
  },

  // === Cross-Chain Routes ===
  BTC_TO_ETH: {
    from: getFinFormat('btc'),
    to: getFinFormat('eth'),
    name: 'BTC → ETH',
    description: 'Swap native Bitcoin to native Ethereum',
    liquidity: 'deep' as const,
    typicalTime: '10-60 minutes (Bitcoin confirmations)',
  },
  ETH_TO_BTC: {
    from: getFinFormat('eth'),
    to: getFinFormat('btc'),
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
 * All denoms are in FIN format from @vultisig/assets
 */
export const ASSETS = {
  // Native chain assets
  RUNE: getFinFormat('rune'),
  BTC: getFinFormat('btc'),
  ETH: getFinFormat('eth'),
  AVAX: getFinFormat('avax'),
  ATOM: getFinFormat('atom'),
  DOGE: getFinFormat('doge'),
  LTC: getFinFormat('ltc'),
  BCH: getFinFormat('bch'),
  BNB: getFinFormat('bnb'),

  // Stablecoins (Ethereum)
  USDC: getFinFormat('usdc_eth'),
  USDT: getFinFormat('usdt_eth'),

  // Rujira native tokens
  RUJI: getFinFormat('ruji'),
  TCY: getFinFormat('tcy'),
} as const;

export type AssetName = keyof typeof ASSETS;
export type EasyAsset = (typeof ASSETS)[AssetName];

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
 * Uses @vultisig/assets registry for accurate ticker lookup
 */
function denomToTicker(denom: string): string {
  // Try to find the asset by FIN format
  for (const asset of Object.values(KNOWN_ASSETS) as Asset[]) {
    if (asset.formats.fin === denom) {
      return asset.name.split(' ')[0].toUpperCase(); // Get first word of name
    }
  }
  
  // Fallback to parsing denom format
  const parts = denom.split('-');
  if (parts.length >= 2) {
    return parts[1].toUpperCase().split('-')[0];
  }
  
  return denom.toUpperCase();
}
