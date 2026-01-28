/**
 * Discovery types
 * @module discovery/types
 */

/**
 * Market/trading pair from Rujira API
 */
export interface Market {
  /** FIN contract address */
  address: string;
  /** Base asset (e.g., "BTC.BTC") */
  baseAsset: string;
  /** Quote asset (e.g., "THOR.RUNE") */
  quoteAsset: string;
  /** Base asset denom */
  baseDenom: string;
  /** Quote asset denom */
  quoteDenom: string;
  /** Tick size */
  tick: string;
  /** Taker fee */
  takerFee: string;
  /** Maker fee */
  makerFee: string;
  /** Whether market is active */
  active: boolean;
}

/**
 * Discovered contracts result
 */
export interface DiscoveredContracts {
  /** FIN contracts by pair key (e.g., "BTC.BTC/THOR.RUNE") */
  fin: Record<string, string>;
  /** BOW (AMM) contracts if discovered */
  bow?: Record<string, string>;
  /** Other contracts */
  other?: Record<string, string>;
  /** Discovery timestamp */
  discoveredAt: number;
  /** Source of discovery */
  source: 'graphql' | 'chain' | 'cache' | 'fallback-failed';
  /** Last error message if discovery failed */
  lastError?: string;
}

/**
 * GraphQL market response
 */
export interface GraphQLMarketsResponse {
  markets: Array<{
    address: string;
    denoms: {
      base: string;
      quote: string;
    };
    config?: {
      tick?: string;
      fee_taker?: string;
      fee_maker?: string;
    };
  }>;
}
