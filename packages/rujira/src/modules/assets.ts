/**
 * Assets module for managing Rujira assets
 * @module modules/assets
 */

import type { RujiraClient } from '../client.js';
import { KNOWN_ASSETS, findAssetByFormat, type Asset } from '@vultisig/assets';
import type { RujiraAsset, TradingPair } from '../types.js';
import { DEFAULT_TAKER_FEE, DEFAULT_MAKER_FEE } from '../config/constants.js';
import { parseAsset as sharedParseAsset } from '../utils/denom-conversion.js';

/**
 * Type guard to check if an object is a valid Asset with FIN format
 * @internal
 */
function isFinAsset(obj: unknown): obj is Asset & { formats: { fin: string } } {
  if (!obj || typeof obj !== 'object') return false;
  const asset = obj as Partial<Asset>;
  return (
    typeof asset.formats === 'object' &&
    asset.formats !== null &&
    typeof asset.formats.fin === 'string' &&
    asset.formats.fin.length > 0
  );
}

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
    return (Object.values(KNOWN_ASSETS) as Asset[])
      .filter(isFinAsset)
      .map((asset) => ({
        asset: asset.formats.thorchain,
        chain: asset.chain,
        symbol: asset.formats.l1,
        ticker: asset.id.toUpperCase(),
        decimals: asset.decimals.fin,
        type: this.getAssetType(asset.formats.thorchain),
        denom: asset.formats.fin,
      }));
  }

  /**
   * Get information about a specific asset
   */
  async getAsset(assetFormat: string): Promise<RujiraAsset | null> {
    const asset = findAssetByFormat(assetFormat);
    
    if (!isFinAsset(asset)) {
      return null;
    }
    
    return {
      asset: asset.formats.thorchain,
      chain: asset.chain,
      symbol: asset.formats.l1,
      ticker: asset.id.toUpperCase(),
      decimals: asset.decimals.fin,
      type: this.getAssetType(asset.formats.thorchain),
      denom: asset.formats.fin,
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
        takerFee: DEFAULT_TAKER_FEE,
        makerFee: DEFAULT_MAKER_FEE,
      });
    }

    return pairs;
  }

  /**
   * Check if an asset is supported
   */
  isSupported(asset: string): boolean {
    const found = findAssetByFormat(asset);
    return isFinAsset(found);
  }

  /**
   * Get the denom for an asset
   */
  getDenom(asset: string): string | undefined {
    const found = findAssetByFormat(asset);
    return isFinAsset(found) ? found.formats.fin : undefined;
  }

  /**
   * Get decimals for an asset
   */
  getDecimals(asset: string): number | undefined {
    const found = findAssetByFormat(asset);
    return isFinAsset(found) ? found.decimals.fin : undefined;
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
    return sharedParseAsset(asset);
  }

  /**
   * Format asset string from components
   */
  formatAsset(chain: string, symbol: string): string {
    return `${chain}.${symbol}`;
  }

  // INTERNAL

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
