/**
 * Assets module for managing Rujira assets
 * @module modules/assets
 */

import type { RujiraClient } from '../client';
import { KNOWN_ASSETS, getAsset } from '@vultisig/assets';
import type { RujiraAsset, TradingPair } from '../types';

/**
 * Assets module for querying asset information
 * 
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet' });
 * await client.connect();
 * 
 * // Get all supported assets
 * const assets = await client.assets.getAssets();
 * 
 * // Get specific asset info
 * const btc = await client.assets.getAsset('BTC.BTC');
 * console.log(`BTC decimals: ${btc.decimals}`);
 * ```
 */
export class RujiraAssets {
  constructor(private readonly client: RujiraClient) {}

  /**
   * Get all supported assets
   */
  async getAssets(): Promise<RujiraAsset[]> {
    // Use @vultisig/assets registry as the source of truth.
    // Only return assets that have a FIN denom, since those are tradable/holdable on THORChain.
    const registry = Array.isArray(KNOWN_ASSETS)
      ? KNOWN_ASSETS
      : (Object.values(KNOWN_ASSETS) as unknown[]);

    return (registry as any[])
      .filter((a) => a?.formats?.fin)
      .map((a) => {
        const asset = a.formats?.full ?? a.ticker ?? a.name;
        const parts = String(asset).split('.');
        const chain = parts[0] || '';
        const symbol = parts[1] || '';
        const ticker = symbol.split('-')[0] || '';

        return {
          asset: String(asset),
          chain,
          symbol,
          ticker,
          decimals: a.decimals?.fin ?? 8,
          type: this.getAssetType(String(asset)),
          denom: a.formats.fin,
        } as RujiraAsset;
      });
  }

  /**
   * Get information about a specific asset
   */
  async getAsset(asset: string): Promise<RujiraAsset | null> {
    let a: any;
    try {
      a = getAsset(asset);
    } catch {
      a = null;
    }

    if (!a?.formats?.fin) return null;

    const parts = asset.split('.');
    const chain = parts[0] || '';
    const symbol = parts[1] || '';
    const ticker = symbol.split('-')[0] || '';

    return {
      asset,
      chain,
      symbol,
      ticker,
      decimals: a.decimals?.fin ?? 8,
      type: this.getAssetType(asset),
      denom: a.formats.fin,
    };
  }

  /**
   * Get available trading pairs
   */
  async getTradingPairs(): Promise<TradingPair[]> {
    // Return known pairs from config
    const pairs: TradingPair[] = [];
    const finContracts = this.client.config.contracts.finContracts;

    for (const [pairKey, address] of Object.entries(finContracts)) {
      const [base, quote] = pairKey.split('/');
      pairs.push({
        base,
        quote,
        contractAddress: address,
        tick: '0.0001', // Would come from contract config
        takerFee: '0.0015',
        makerFee: '0.00075',
      });
    }

    return pairs;
  }

  /**
   * Check if an asset is supported
   */
  isSupported(asset: string): boolean {
    try {
      const a: any = getAsset(asset);
      return Boolean(a?.formats?.fin);
    } catch {
      return false;
    }
  }

  /**
   * Get the denom for an asset
   */
  getDenom(asset: string): string | undefined {
    try {
      const a: any = getAsset(asset);
      return a?.formats?.fin;
    } catch {
      return undefined;
    }
  }

  /**
   * Get decimals for an asset
   */
  getDecimals(asset: string): number | undefined {
    try {
      const a: any = getAsset(asset);
      return a?.decimals?.fin;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse asset string to components
   */
  parseAsset(asset: string): {
    chain: string;
    symbol: string;
    ticker: string;
    contractAddress?: string;
  } {
    const parts = asset.split('.');
    const chain = parts[0] || '';
    const rest = parts[1] || '';
    const symbolParts = rest.split('-');
    const ticker = symbolParts[0] || '';
    const contractAddress = symbolParts[1];
    
    return {
      chain,
      symbol: rest,
      ticker,
      contractAddress: contractAddress ? `0x${contractAddress}` : undefined,
    };
  }

  /**
   * Format asset string from components
   */
  formatAsset(chain: string, symbol: string): string {
    return `${chain}.${symbol}`;
  }

  // ============================================================================
  // INTERNAL
  // ============================================================================

  /**
   * Determine asset type
   */
  private getAssetType(asset: string): 'native' | 'secured' | 'synthetic' {
    if (asset === 'THOR.RUNE') {
      return 'native';
    }
    if (asset.includes('/')) {
      return 'synthetic';
    }
    return 'secured';
  }
}
