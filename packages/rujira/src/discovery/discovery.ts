import { GraphQLClient, type GraphQLClientOptions } from './graphql-client.js';
import type { DiscoveredContracts, Market } from './types.js';
import { MAINNET_CONFIG } from '../config.js';

export interface DiscoveryOptions {
  graphql?: GraphQLClientOptions;
  rpcEndpoint?: string;
  cacheTtl?: number;
  debug?: boolean;
}

export class RujiraDiscovery {
  private graphql: GraphQLClient;
  private rpcEndpoint: string;
  private cacheTtl: number;
  private debug: boolean;
  private finCodeId: number;
  private cache: DiscoveredContracts | null = null;
  private pendingDiscovery: Promise<DiscoveredContracts> | null = null;

  constructor(options: DiscoveryOptions = {}) {
    const networkConfig = MAINNET_CONFIG;

    this.rpcEndpoint = options.rpcEndpoint || networkConfig.rpcEndpoint;
    this.cacheTtl = options.cacheTtl ?? 5 * 60 * 1000;
    this.debug = options.debug || false;
    this.finCodeId = networkConfig.contracts.finCodeId;

    // Mainnet-only GraphQL endpoints
    this.graphql = new GraphQLClient({
      httpEndpoint: 'https://api.rujira.network/api/graphql',
      wsEndpoint: 'wss://api.rujira.network/socket',
      ...options.graphql,
    });
  }

  async discoverContracts(forceRefresh = false): Promise<DiscoveredContracts> {
    if (!forceRefresh && this.cache && this.isCacheValid()) {
      this.log('Using cached contracts');
      return this.cache;
    }

    if (this.pendingDiscovery) {
      this.log('Discovery already in progress, waiting for existing request...');
      return this.pendingDiscovery;
    }

    this.log('Discovering contracts...');
    this.pendingDiscovery = this.performDiscovery();

    try {
      return await this.pendingDiscovery;
    } finally {
      this.pendingDiscovery = null;
    }
  }

  private async performDiscovery(): Promise<DiscoveredContracts> {
    try {
      const contracts = await this.discoverViaGraphQL();
      this.cache = contracts;
      return contracts;
    } catch (error) {
      this.log('GraphQL discovery failed, analyzing error...', error);

      if (!this.shouldFallbackToChain(error)) {
        this.log('Error is not recoverable, failing without fallback');
        throw error;
      }

      this.log('Error is recoverable, trying chain query fallback...');

      try {
        const contracts = await this.discoverViaChain();
        this.cache = contracts;
        return contracts;
      } catch (chainError) {
        this.log('Chain discovery also failed', chainError);

        if (error instanceof GraphQLClient.GraphQLError && error.type === 'auth') {
          throw error;
        }

        return {
          fin: {},
          discoveredAt: Date.now(),
          source: 'fallback-failed',
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  private shouldFallbackToChain(error: unknown): boolean {
    if (error instanceof GraphQLClient.GraphQLError) {
      switch (error.type) {
        case 'auth':
          return false;
        default:
          return true;
      }
    }

    return true;
  }

  async findMarket(baseAsset: string, quoteAsset: string): Promise<Market | null> {
    try {
      const market = await this.graphql.getMarket(baseAsset, quoteAsset);

      if (market) {
        return this.transformMarket(market);
      }

      const reverseMarket = await this.graphql.getMarket(quoteAsset, baseAsset);
      if (reverseMarket) {
        return this.transformMarket(reverseMarket);
      }

      return null;
    } catch (error) {
      this.log('findMarket failed', error);

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

  async getContractAddress(baseAsset: string, quoteAsset: string): Promise<string | null> {
    const market = await this.findMarket(baseAsset, quoteAsset);
    return market?.address || null;
  }

  async listMarkets(): Promise<Market[]> {
    try {
      const response = await this.graphql.getMarkets();
      return response.markets.map((m) => this.transformMarket(m));
    } catch (error) {
      this.log('listMarkets failed', error);
      return [];
    }
  }

  clearCache(): void {
    this.cache = null;
  }

  getCacheTtl(): number {
    return this.cacheTtl;
  }

  getCacheStatus(): { cached: boolean; age?: number; valid: boolean; ttl: number } {
    const ttl = this.cacheTtl;

    if (!this.cache) {
      return { cached: false, valid: false, ttl };
    }

    const age = Date.now() - this.cache.discoveredAt;
    const valid = this.isCacheValid();

    return { cached: true, age, valid, ttl };
  }

  private async discoverViaGraphQL(): Promise<DiscoveredContracts> {
    const response = await this.graphql.getMarkets();

    const fin: Record<string, string> = {};

    for (const market of response.markets) {
      const pairKey = `${market.denoms.base}/${market.denoms.quote}`;
      fin[pairKey] = market.address;
    }

    return {
      fin,
      discoveredAt: Date.now(),
      source: 'graphql',
    };
  }

  private async discoverViaChain(): Promise<DiscoveredContracts> {
    const fin: Record<string, string> = {};

    const baseUrl = this.rpcEndpoint.replace(':26657', '').replace('rpc', 'thornode');
    const restUrl = baseUrl.includes('thornode') ? baseUrl : 'https://thornode.ninerealms.com';

    try {
      const contractsResponse = await fetch(
        `${restUrl}/cosmwasm/wasm/v1/code/${this.finCodeId}/contracts`
      );

      if (!contractsResponse.ok) {
        throw new Error(`Failed to fetch contracts: ${contractsResponse.status}`);
      }

      const contractsData = (await contractsResponse.json()) as { contracts: string[] };
      this.log(`Found ${contractsData.contracts.length} FIN contracts`);

      // Query contract configs in parallel with concurrency cap
      const CONCURRENCY = 5;
      const addresses = contractsData.contracts;
      for (let i = 0; i < addresses.length; i += CONCURRENCY) {
        const batch = addresses.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (address) => {
            const configResponse = await fetch(
              `${restUrl}/cosmwasm/wasm/v1/contract/${address}/smart/eyJjb25maWciOnt9fQ==`
            );

            if (!configResponse.ok) return null;

            const configData = (await configResponse.json()) as {
              data: {
                denoms: string[];
                fee_taker: string;
                fee_maker: string;
              };
            };

            if (configData.data?.denoms?.length === 2) {
              const base = this.normalizeDenom(configData.data.denoms[0]);
              const quote = this.normalizeDenom(configData.data.denoms[1]);
              return { pairKey: `${base}/${quote}`, address };
            }
            return null;
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            fin[result.value.pairKey] = result.value.address;
            this.log(`Discovered: ${result.value.pairKey} -> ${result.value.address.slice(0, 20)}...`);
          } else if (result.status === 'rejected') {
            this.log('Failed to query contract config:', result.reason);
          }
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

  private normalizeDenom(denom: string): string {
    return denom.toLowerCase();
  }

  private transformMarket(market: {
    address: string;
    denoms: { base: string; quote: string };
    config?: { tick?: string; fee_taker?: string; fee_maker?: string };
  }): Market {
    const baseDenom = market.denoms.base.toLowerCase();
    const quoteDenom = market.denoms.quote.toLowerCase();

    return {
      address: market.address,
      baseAsset: baseDenom,
      quoteAsset: quoteDenom,
      baseDenom,
      quoteDenom,
      tick: market.config?.tick || '0',
      takerFee: market.config?.fee_taker || '0.0015',
      makerFee: market.config?.fee_maker || '0.00075',
      active: true,
    };
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    if (this.cacheTtl === 0) return false;
    return Date.now() - this.cache.discoveredAt < this.cacheTtl;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[RujiraDiscovery]', ...args);
    }
  }
}
