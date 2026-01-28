/**
 * Contract discovery for Rujira SDK
 * @module discovery/discovery
 */

import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GraphQLClient, type GraphQLClientOptions } from './graphql-client';
import type { Market, DiscoveredContracts } from './types';
import { MAINNET_CONFIG, STAGENET_CONFIG, type NetworkType } from '../config';

/**
 * Discovery options
 */
export interface DiscoveryOptions {
  /** Network to discover on */
  network?: NetworkType;
  /** GraphQL client options */
  graphql?: GraphQLClientOptions;
  /** RPC endpoint override */
  rpcEndpoint?: string;
  /** Cache TTL in ms (default: 5 minutes) */
  cacheTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Known FIN code hashes for verification
 */
const FIN_CODE_HASHES = {
  'v1.1': '240a0994d37b7eb80bf2273c4224c736194160353ba6ccd9ae893eeab88794b9',
  'v1.0.1': '6eb73e0bbe8e3da2e757bff9915e96060cc36df1be46914a92bceb95e8cf7920',
  'v1.0.0': '', // Add if known
};

/**
 * Contract discovery service
 * 
 * Discovers FIN contract addresses via:
 * 1. Rujira GraphQL API (primary)
 * 2. On-chain query fallback
 * 
 * @example
 * ```typescript
 * const discovery = new RujiraDiscovery({ network: 'mainnet' });
 * 
 * // Discover all markets
 * const contracts = await discovery.discoverContracts();
 * console.log(contracts.fin); // { "BTC.BTC/THOR.RUNE": "thor1...", ... }
 * 
 * // Find specific market
 * const btcRune = await discovery.findMarket('BTC.BTC', 'THOR.RUNE');
 * console.log(btcRune?.address);
 * ```
 */
export class RujiraDiscovery {
  private graphql: GraphQLClient;
  private rpcEndpoint: string;
  private cacheTtl: number;
  private debug: boolean;
  private cache: DiscoveredContracts | null = null;
  private cosmClient: CosmWasmClient | null = null;
  /** Pending discovery promise to prevent duplicate concurrent requests */
  private pendingDiscovery: Promise<DiscoveredContracts> | null = null;

  constructor(options: DiscoveryOptions = {}) {
    const networkConfig = options.network === 'stagenet' 
      ? STAGENET_CONFIG 
      : MAINNET_CONFIG;

    this.rpcEndpoint = options.rpcEndpoint || networkConfig.rpcEndpoint;
    this.cacheTtl = options.cacheTtl || 5 * 60 * 1000; // 5 minutes
    this.debug = options.debug || false;

    // Initialize GraphQL client
    // Note: Rujira uses Phoenix/Absinthe so the HTTP endpoint is /api/graphql
    this.graphql = new GraphQLClient({
      httpEndpoint: options.network === 'stagenet'
        ? 'https://preview-api.rujira.network/api/graphql'
        : 'https://api.rujira.network/api/graphql',
      wsEndpoint: options.network === 'stagenet'
        ? 'wss://preview-api.rujira.network/socket'
        : 'wss://api.rujira.network/socket',
      ...options.graphql,
    });
  }

  /**
   * Discover all FIN contracts
   * 
   * Uses pending promise pattern to prevent duplicate concurrent API requests.
   * Multiple callers during discovery will share the same promise.
   * 
   * @param forceRefresh - Bypass cache
   * @returns Discovered contracts
   */
  async discoverContracts(forceRefresh = false): Promise<DiscoveredContracts> {
    // Check cache first (unless force refresh)
    if (!forceRefresh && this.cache && this.isCacheValid()) {
      this.log('Using cached contracts');
      return this.cache;
    }

    // If there's already a pending discovery, wait for it instead of starting a new one
    // This prevents duplicate concurrent API requests
    if (this.pendingDiscovery) {
      this.log('Discovery already in progress, waiting for existing request...');
      return this.pendingDiscovery;
    }

    this.log('Discovering contracts...');

    // Start discovery and store the promise
    this.pendingDiscovery = this.performDiscovery();
    
    try {
      const result = await this.pendingDiscovery;
      return result;
    } finally {
      // Clear pending promise when done (success or failure)
      this.pendingDiscovery = null;
    }
  }

  /**
   * Internal discovery implementation
   * Separated to allow pending promise pattern in discoverContracts
   */
  private async performDiscovery(): Promise<DiscoveredContracts> {
    try {
      // Try GraphQL first
      const contracts = await this.discoverViaGraphQL();
      this.cache = contracts;
      return contracts;
    } catch (error) {
      this.log('GraphQL discovery failed, trying chain query...', error);
      
      try {
        // Fallback to chain query
        const contracts = await this.discoverViaChain();
        this.cache = contracts;
        return contracts;
      } catch (chainError) {
        this.log('Chain discovery also failed', chainError);
        
        // Return empty if both fail
        return {
          fin: {},
          discoveredAt: Date.now(),
          source: 'cache',
        };
      }
    }
  }

  /**
   * Find a specific market by assets
   */
  async findMarket(baseAsset: string, quoteAsset: string): Promise<Market | null> {
    try {
      // Try GraphQL direct query
      const market = await this.graphql.getMarket(baseAsset, quoteAsset);
      
      if (market) {
        return this.transformMarket(market);
      }

      // Try reverse pair
      const reverseMarket = await this.graphql.getMarket(quoteAsset, baseAsset);
      if (reverseMarket) {
        return this.transformMarket(reverseMarket);
      }

      return null;
    } catch (error) {
      this.log('findMarket failed', error);
      
      // Try from cache
      const contracts = await this.discoverContracts();
      const pairKey = `${baseAsset}/${quoteAsset}`;
      const reversePairKey = `${quoteAsset}/${baseAsset}`;
      
      const address = contracts.fin[pairKey] || contracts.fin[reversePairKey];
      
      if (address) {
        return {
          address,
          baseAsset,
          quoteAsset,
          baseDenom: '',
          quoteDenom: '',
          tick: '0',
          takerFee: '0.0015',
          makerFee: '0.00075',
          active: true,
        };
      }

      return null;
    }
  }

  /**
   * Get contract address for a trading pair
   */
  async getContractAddress(baseAsset: string, quoteAsset: string): Promise<string | null> {
    const market = await this.findMarket(baseAsset, quoteAsset);
    return market?.address || null;
  }

  /**
   * List all available markets
   */
  async listMarkets(): Promise<Market[]> {
    try {
      const response = await this.graphql.getMarkets();
      return response.markets.map(m => this.transformMarket(m));
    } catch (error) {
      this.log('listMarkets failed', error);
      return [];
    }
  }

  /**
   * Clear the discovery cache
   */
  clearCache(): void {
    this.cache = null;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Discover contracts via GraphQL API
   */
  private async discoverViaGraphQL(): Promise<DiscoveredContracts> {
    const response = await this.graphql.getMarkets();
    
    const fin: Record<string, string> = {};
    
    for (const market of response.markets) {
      // Build pair key from denoms
      const pairKey = `${market.denoms.base}/${market.denoms.quote}`;
      fin[pairKey] = market.address;
    }

    return {
      fin,
      discoveredAt: Date.now(),
      source: 'graphql',
    };
  }

  /**
   * Discover contracts via chain query (fallback)
   * Uses THORNode REST API to query CosmWasm contracts
   */
  private async discoverViaChain(): Promise<DiscoveredContracts> {
    const fin: Record<string, string> = {};
    
    // FIN contracts are deployed under code ID 73 on mainnet
    const FIN_CODE_ID = '73';
    const baseUrl = this.rpcEndpoint.replace(':26657', '').replace('rpc', 'thornode');
    const restUrl = baseUrl.includes('thornode') ? baseUrl : 'https://thornode.ninerealms.com';
    
    try {
      // Get all FIN contracts from code 73
      const contractsResponse = await fetch(
        `${restUrl}/cosmwasm/wasm/v1/code/${FIN_CODE_ID}/contracts`
      );
      
      if (!contractsResponse.ok) {
        throw new Error(`Failed to fetch contracts: ${contractsResponse.status}`);
      }
      
      const contractsData = await contractsResponse.json() as { contracts: string[] };
      this.log(`Found ${contractsData.contracts.length} FIN contracts`);
      
      // Query each contract's config to get the trading pair
      for (const address of contractsData.contracts) {
        try {
          // Query config: base64 of {"config":{}}
          const configResponse = await fetch(
            `${restUrl}/cosmwasm/wasm/v1/contract/${address}/smart/eyJjb25maWciOnt9fQ==`
          );
          
          if (configResponse.ok) {
            const configData = await configResponse.json() as {
              data: {
                denoms: string[];
                fee_taker: string;
                fee_maker: string;
              };
            };
            
            if (configData.data?.denoms?.length === 2) {
              // Convert denoms to asset format and create pair key
              const base = this.denomToAsset(configData.data.denoms[0]);
              const quote = this.denomToAsset(configData.data.denoms[1]);
              const pairKey = `${base}/${quote}`;
              fin[pairKey] = address;
              this.log(`Discovered: ${pairKey} -> ${address.slice(0, 20)}...`);
            }
          }
        } catch (e) {
          this.log(`Failed to query config for ${address}:`, e);
        }
      }
      
      this.log(`Chain discovery complete: ${Object.keys(fin).length} markets`);
    } catch (error) {
      this.log('Chain discovery failed:', error);
    }

    return {
      fin,
      discoveredAt: Date.now(),
      source: 'chain',
    };
  }
  
  /**
   * Convert denom to asset string
   * e.g., "btc-btc" -> "BTC.BTC", "eth-usdc-0x..." -> "ETH.USDC-0x..."
   */
  private denomToAsset(denom: string): string {
    if (denom === 'rune') return 'THOR.RUNE';
    if (denom === 'tcy') return 'THOR.TCY';
    if (denom.startsWith('thor.')) return `THOR.${denom.slice(5).toUpperCase()}`;
    if (denom.startsWith('x/')) return `THOR.${denom.slice(2).toUpperCase()}`;
    
    // Handle chain-asset format like "btc-btc" or "eth-usdc-0x..."
    const dashIndex = denom.indexOf('-');
    if (dashIndex > 0) {
      const chain = denom.slice(0, dashIndex).toUpperCase();
      const asset = denom.slice(dashIndex + 1).toUpperCase();
      return `${chain}.${asset}`;
    }
    
    return denom.toUpperCase();
  }

  /**
   * Transform GraphQL market response to Market type
   */
  private transformMarket(market: {
    address: string;
    denoms: { base: string; quote: string };
    config?: { tick?: string; fee_taker?: string; fee_maker?: string };
  }): Market {
    // The API now returns asset strings directly (e.g., "BTC.BTC")
    // rather than denoms (e.g., "btc/btc")
    const baseAsset = market.denoms.base;
    const quoteAsset = market.denoms.quote;
    
    return {
      address: market.address,
      baseAsset,
      quoteAsset,
      baseDenom: this.assetToDenom(baseAsset),
      quoteDenom: this.assetToDenom(quoteAsset),
      tick: market.config?.tick || '0',
      takerFee: market.config?.fee_taker || '0.0015',
      makerFee: market.config?.fee_maker || '0.00075',
      active: true,
    };
  }

  /**
   * Convert asset string to denom
   * e.g., "BTC.BTC" -> "btc/btc", "THOR.RUNE" -> "rune"
   */
  private assetToDenom(asset: string): string {
    if (asset === 'THOR.RUNE' || asset === 'rune') {
      return 'rune';
    }
    
    // Handle THORChain L1 assets like "BTC.BTC" -> "btc/btc"
    if (asset.includes('.')) {
      const [chain, symbol] = asset.split('.');
      // Handle contract assets like "ETH.USDC-0x..."
      const baseSymbol = symbol.split('-')[0];
      return `${chain.toLowerCase()}/${baseSymbol.toLowerCase()}`;
    }
    
    return asset.toLowerCase();
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.discoveredAt < this.cacheTtl;
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[RujiraDiscovery]', ...args);
    }
  }
}
