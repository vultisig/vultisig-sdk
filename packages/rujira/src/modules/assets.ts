/**
 * Assets module for managing Rujira assets
 * @module modules/assets
 */

import type { RujiraClient } from '../client';
import { SECURED_ASSETS, getAssetInfo } from '../config';
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
    // For now, return static list
    // TODO: Query from chain/API for dynamic list
    return Object.entries(SECURED_ASSETS).map(([asset, info]) => {
      const parts = asset.split('.');
      const chain = parts[0] || '';
      const symbol = parts[1] || '';
      const ticker = symbol.split('-')[0] || '';
      return {
        asset,
        chain,
        symbol,
        ticker,
        decimals: (info as { denom: string; decimals: number }).decimals,
        type: this.getAssetType(asset),
        denom: (info as { denom: string; decimals: number }).denom,
      };
    });
  }

  /**
   * Get information about a specific asset
   */
  async getAsset(asset: string): Promise<RujiraAsset | null> {
    const info = getAssetInfo(asset);
    if (!info) {
      return null;
    }

    const parts = asset.split('.');
    const chain = parts[0] || '';
    const symbol = parts[1] || '';
    const ticker = symbol.split('-')[0] || '';
    
    return {
      asset,
      chain,
      symbol,
      ticker,
      decimals: info.decimals,
      type: this.getAssetType(asset),
      denom: info.denom,
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
    return getAssetInfo(asset) !== undefined;
  }

  /**
   * Get the denom for an asset
   */
  getDenom(asset: string): string | undefined {
    return getAssetInfo(asset)?.denom;
  }

  /**
   * Get decimals for an asset
   */
  getDecimals(asset: string): number | undefined {
    return getAssetInfo(asset)?.decimals;
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
