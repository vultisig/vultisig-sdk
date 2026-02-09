/**
 * Canonical denom-to-ticker and denom-to-asset conversion
 * @module utils/denom-conversion
 */

import { findAssetByFormat, KNOWN_ASSETS, type Asset } from '@vultisig/assets';

/**
 * Convert a denom (any format) to a short ticker for display.
 *
 * Resolution order:
 * 1. Look up via findAssetByFormat (handles thorchain, fin, l1 formats)
 * 2. Iterate KNOWN_ASSETS checking fin format (catches cases where denom is a raw fin string)
 * 3. Parse denom string (chain-symbol → SYMBOL)
 *
 * @param denom - Denom string in any format
 * @returns Short ticker (e.g., "BTC", "USDC", "RUNE")
 */
export function denomToTicker(denom: string): string {
  // 1. Try findAssetByFormat (handles all known formats)
  const asset = findAssetByFormat(denom);
  if (asset) {
    return asset.id.toUpperCase();
  }

  // 2. Try matching fin format directly against known assets
  for (const knownAsset of Object.values(KNOWN_ASSETS) as Asset[]) {
    if (knownAsset.formats.fin === denom) {
      return knownAsset.name.split(' ')[0].toUpperCase();
    }
  }

  // 3. Parse denom string
  const parts = denom.split('-');
  if (parts.length >= 2) {
    return (parts[1] || '').toUpperCase();
  }

  return denom.toUpperCase();
}

/**
 * Convert a denom to a THORChain asset identifier (e.g., "BTC.BTC").
 *
 * Resolution order:
 * 1. Look up via findAssetByFormat → return thorchain format
 * 2. Reverse-engineer from denom format (chain-symbol → CHAIN.SYMBOL)
 *
 * @param denom - Denom string in any format
 * @returns THORChain asset string or null if unresolvable
 */
export function denomToAsset(denom: string): string | null {
  // 1. Look up in asset registry
  const asset = findAssetByFormat(denom);
  if (asset) {
    return asset.formats.thorchain;
  }

  // 2. Reverse-engineer from denom format: btc-btc -> BTC.BTC
  if (denom.includes('-')) {
    const parts = denom.split('-');
    if (parts.length >= 2) {
      const chain = (parts[0] || '').toUpperCase();
      const symbol = parts.slice(1).join('-').toUpperCase();
      return `${chain}.${symbol}`;
    }
  }

  return null;
}

/**
 * Extract a display symbol from an asset string or denom.
 *
 * @param assetOrDenom - Asset string (e.g., "ETH.USDC-0X...") or denom
 * @returns Symbol (e.g., "USDC")
 */
export function extractSymbol(assetOrDenom: string): string {
  // Handle full asset format: ETH.USDC-0X... -> USDC
  if (assetOrDenom.includes('.')) {
    const afterDot = assetOrDenom.split('.')[1] || '';
    const symbol = afterDot.split('-')[0] || '';
    return symbol.toUpperCase();
  }

  // Handle denom format: eth-usdc-0x... -> USDC
  if (assetOrDenom.includes('-')) {
    const parts = assetOrDenom.split('-');
    if (parts.length >= 2) {
      return (parts[1] || '').toUpperCase();
    }
  }

  // Simple case: rune -> RUNE
  return assetOrDenom.toUpperCase();
}

/**
 * Parse a THORChain asset string into its components.
 *
 * @param asset - Asset string (e.g., "ETH.USDC-0XA0B86991...")
 * @returns Parsed components
 */
export function parseAsset(asset: string): {
  chain: string;
  symbol: string;
  ticker: string;
  contractAddress?: string;
} {
  const parts = asset.split('.');
  const chain = (parts[0] || '').toUpperCase();
  const rest = parts.slice(1).join('.') || '';
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
