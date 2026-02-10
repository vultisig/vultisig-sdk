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

// EASY ROUTES - Start Here!
// Simple DeFi for agents and humans. Pick a route, swap.
export type {
  AssetName,
  EasyAsset,
  EasyQuoteResponse,
  EasyRoute,
  EasyRouteName,
  EasySwapRequest,
} from './easy-routes.js'
export {
  ASSETS,
  EASY_ROUTES,
  findRoute,
  getRoute,
  getRoutesSummary,
  listEasyRoutes,
  routesForAsset,
  routesFrom,
  routesTo,
} from './easy-routes.js'

// CORE SDK
export * from './config.js'
export * from './errors.js'
export * from './types.js'

// Client exports
export type { RujiraClientOptions } from './client.js'
export { RujiraClient } from './client.js'

// Module exports
export { RujiraAssets } from './modules/assets.js'
export { RujiraOrderbook } from './modules/orderbook.js'
export { RujiraSwap } from './modules/swap.js'

// Signer exports (for Vultisig integration)
export type { RujiraSigner, VultisigVault } from './signer/types.js'
export { VultisigRujiraProvider } from './signer/vultisig-provider.js'

// Utility exports
export * from './utils/format.js'
export * from './utils/memo.js'

// Discovery exports
export { RujiraDiscovery } from './discovery/discovery.js'
export { GraphQLClient } from './discovery/graphql-client.js'
export type { DiscoveredContracts, Market } from './discovery/types.js'
