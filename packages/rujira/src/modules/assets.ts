/**
 * Assets module for managing Rujira assets
 * @module modules/assets
 */

import type { RujiraClient } from '../client';
import { KNOWN_ASSETS, getAsset } from '@vultisig/assets';
import type { Asset } from '@vultisig/assets';
import type { RujiraAsset, TradingPair } from '../types';

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
    // Use @vultisig/assets registry as the source of truth.
    // Only return assets that have a FIN denom, since those are tradable/holdable on THORChain.
    const registry: unknown[] = Array.isArray(KNOWN_ASSETS)
      ? KNOWN_ASSETS
      : Object.values(KNOWN_ASSETS);

    return registry
      .filter(isFinAsset)
      .map((a) => {
        // Use thorchain format as the canonical asset identifier
        const assetStr = a.formats.thorchain || a.name || a.id;
        const parts = assetStr.split('.');
        const chain = parts[0] || '';
        const symbol = parts[1] || '';
        const ticker = symbol.split('-')[0] || '';

        return {
          asset: assetStr,
          chain,
          symbol,
          ticker,
          decimals: a.decimals.fin,
          type: this.getAssetType(assetStr),
          denom: a.formats.fin,
        } as RujiraAsset;
      });
  }

  /**
   * Get information about a specific asset
   */
  async getAsset(asset: string): Promise<RujiraAsset | null> {
    let assetData: Asset | null;
    try {
      assetData = getAsset(asset);
    } catch {
      assetData = null;
    }

    if (!isFinAsset(assetData)) return null;

    const parts = asset.split('.');
    const chain = parts[0] || '';
    const symbol = parts[1] || '';
    const ticker = symbol.split('-')[0] || '';

    return {
      asset,
      chain,
      symbol,
      ticker,
      decimals: assetData.decimals.fin,
      type: this.getAssetType(asset),
      denom: assetData.formats.fin,
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
      const assetData = getAsset(asset);
      return isFinAsset(assetData);
    } catch {
      return false;
    }
  }

  /**
   * Get the denom for an asset
   */
  getDenom(asset: string): string | undefined {
    try {
      const assetData = getAsset(asset);
      if (isFinAsset(assetData)) {
        return assetData.formats.fin;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get decimals for an asset
   */
  getDecimals(asset: string): number | undefined {
    try {
      const assetData = getAsset(asset);
      if (isFinAsset(assetData)) {
        return assetData.decimals.fin;
      }
      return undefined;
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
