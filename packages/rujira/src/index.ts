/**
 * @vultisig/rujira - Rujira DEX Integration for Vultisig SDK
 * 
 * A modular TypeScript SDK for interacting with Rujira DEX on THORChain.
 * Designed for wallets, trading bots, and AI agents.
 * 
 * @example
 * ```typescript
 * import { RujiraClient, RujiraSwap } from '@vultisig/rujira';
 * 
 * // Initialize client
 * const client = new RujiraClient({ network: 'mainnet' });
 * await client.connect();
 * 
 * // Get a quote
 * const quote = await client.swap.getQuote({
 *   fromAsset: 'THOR.RUNE',
 *   toAsset: 'BTC.BTC',
 *   amount: '100000000'
 * });
 * 
 * // Execute swap (with Vultisig signer)
 * const result = await client.swap.execute(quote, { slippageBps: 100 });
 * ```
 * 
 * @packageDocumentation
 */

// ============================================================================
// EASY ROUTES - Start Here!
// ============================================================================
// Simple DeFi for agents and humans. Pick a route, swap.
export {
  EASY_ROUTES,
  ASSETS,
  listEasyRoutes,
  getRoute,
  findRoute,
  routesForAsset,
  routesFrom,
  routesTo,
  getRoutesSummary,
} from './easy-routes';
export type {
  EasyRouteName,
  EasyRoute,
  AssetName,
  EasyAsset,
  EasySwapRequest,
  EasyQuoteResponse,
} from './easy-routes';

// ============================================================================
// CORE SDK
// ============================================================================
export * from './types';
export * from './config';
export * from './errors';

// Client exports
export { RujiraClient } from './client';
export type { RujiraClientOptions } from './client';

// Module exports
export { RujiraSwap } from './modules/swap';
export { RujiraOrderbook } from './modules/orderbook';
export { RujiraAssets } from './modules/assets';

// Signer exports (for Vultisig integration)
export { VultisigRujiraProvider } from './signer/vultisig-provider';
export type { RujiraSigner, VultisigVault } from './signer/types';

// Utility exports
export * from './utils/format';
export * from './utils/memo';

// Discovery exports
export { RujiraDiscovery } from './discovery/discovery';
export { GraphQLClient } from './discovery/graphql-client';
export type { Market, DiscoveredContracts } from './discovery/types';
