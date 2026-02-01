/**
 * Assets module for managing Rujira assets
 * @module modules/assets
 */

import type { RujiraClient } from '../client.js';
import { KNOWN_ASSETS, findAssetByFormat, type Asset } from '@vultisig/assets';
import type { RujiraAsset, TradingPair } from '../types.js';

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
        ticker: asset.name.split(' ')[0].toUpperCase(),
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
      ticker: asset.name.split(' ')[0].toUpperCase(),
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
