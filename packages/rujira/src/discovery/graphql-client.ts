/**
 * GraphQL client for Rujira API
 * @module discovery/graphql-client
 */

import type { GraphQLMarketsResponse } from './types';

/**
 * GraphQL client options
 */
export interface GraphQLClientOptions {
  /** WebSocket endpoint (default: wss://api.rujira.network/socket) */
  wsEndpoint?: string;
  /** HTTP endpoint for queries (default: https://api.rujira.network/graphql) */
  httpEndpoint?: string;
  /** API key if required */
  apiKey?: string;
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Simple GraphQL client for Rujira API
 * Uses HTTP for queries (simpler than WebSocket for discovery)
 */
export class GraphQLClient {
  private httpEndpoint: string;
  private wsEndpoint: string;
  private apiKey?: string;
  private timeout: number;

  constructor(options: GraphQLClientOptions = {}) {
    // Note: The actual endpoint is /api/graphql (Phoenix/Absinthe)
    this.httpEndpoint = options.httpEndpoint || 'https://api.rujira.network/api/graphql';
    this.wsEndpoint = options.wsEndpoint || 'wss://api.rujira.network/socket';
    this.apiKey = options.apiKey;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Execute a GraphQL query
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.httpEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

      if (result.errors && result.errors.length > 0) {
        throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
      }

      return result.data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Query for available FIN markets
   * Uses Rujira's actual GraphQL schema (Phoenix/Absinthe)
   */
  async getMarkets(): Promise<GraphQLMarketsResponse> {
    // Query matches Rujira's actual schema: fin { address assetBase { asset } assetQuote { asset } ... }
    const query = `
      query FinMarkets {
        fin {
          address
          assetBase {
            asset
          }
          assetQuote {
            asset
          }
          tick
          feeTaker
          feeMaker
        }
      }
    `;

    const result = await this.query<{ fin: Array<{
      address: string;
      assetBase: { asset: string };
      assetQuote: { asset: string };
      tick: string;
      feeTaker: string;
      feeMaker: string;
    }> }>(query);

    // Transform to our internal format
    // Normalize asset format: GAIA-ATOM -> GAIA.ATOM (THORChain standard)
    return {
      markets: result.fin.map(m => ({
        address: m.address,
        denoms: {
          base: this.normalizeAsset(m.assetBase.asset),
          quote: this.normalizeAsset(m.assetQuote.asset),
        },
        config: {
          tick: m.tick,
          fee_taker: m.feeTaker,
          fee_maker: m.feeMaker,
        },
      })),
    };
  }

  /**
   * Normalize Rujira asset format to THORChain standard
   * GAIA-ATOM -> GAIA.ATOM, ETH-USDC-0x... -> ETH.USDC-0x...
   * (First dash becomes dot, rest stay as dashes for contract addresses)
   */
  private normalizeAsset(asset: string): string {
    if (!asset) return asset;
    
    // Already has dot (e.g., THOR.AUTO) - leave as-is
    if (asset.includes('.')) return asset;
    
    // Convert first dash to dot: GAIA-ATOM -> GAIA.ATOM
    const dashIndex = asset.indexOf('-');
    if (dashIndex > 0) {
      return asset.slice(0, dashIndex) + '.' + asset.slice(dashIndex + 1);
    }
    
    return asset;
  }

  /**
   * Query for a specific market by pair
   * Note: Rujira doesn't have a single-market query, so we filter from all markets
   */
  async getMarket(baseAsset: string, quoteAsset: string): Promise<GraphQLMarketsResponse['markets'][0] | null> {
    const allMarkets = await this.getMarkets();
    
    // Find the market by matching assets
    const market = allMarkets.markets.find(m => 
      (m.denoms.base === baseAsset && m.denoms.quote === quoteAsset) ||
      (m.denoms.base === quoteAsset && m.denoms.quote === baseAsset)
    );

    return market || null;
  }

  /**
   * Get WebSocket endpoint for subscriptions
   */
  getWsEndpoint(): string {
    return this.wsEndpoint;
  }
}
