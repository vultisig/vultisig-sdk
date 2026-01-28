/**
 * @vultisig/assets - Unified asset and decimal handling for THORChain layers
 * 
 * This package provides a unified interface for handling assets and amounts
 * across three layers: native L1, THORChain, and Rujira FIN.
 */

// Core types and interfaces
export type { Asset, Layer, Quote } from './asset.js';

// Amount class and conversion utilities
export { Amount } from './amount.js';
export {
  nativeToThorchain,
  thorchainToNative,
  thorchainToFin,
  finToThorchain,
  nativeToFin,
  finToNative
} from './amount.js';

// Asset registry
export { 
  KNOWN_ASSETS,
  getAsset,
  getAllAssets,
  findAssetByFormat
} from './registry.js';

// Format converters
export {
  toThorchainFormat,
  toFinFormat,
  toL1Format,
  parseAsset,
  normalizeThorchainPool,
  normalizeFinFormat,
  extractChainFromThorchain,
  extractSymbolFromThorchain,
  extractContractFromThorchain,
  buildThorchainFormat,
  buildFinFormat,
  convertFormat,
  detectFormat
} from './formats.js';

// Swap router
export { SwapRouter } from './router.js';

// Convenience functions

/**
 * Create an Amount from a human-readable string and asset ID
 */
export function createAmount(human: string, assetId: string, layer: Layer = 'native'): Amount {
  const asset = getAsset(assetId);
  if (!asset) {
    throw new Error(`Unknown asset: ${assetId}`);
  }
  return Amount.from(human, asset, layer);
}

/**
 * Parse an asset from any format and create an amount
 */
export function parseAmount(human: string, assetFormat: string, layer: Layer = 'native'): Amount {
  const asset = parseAsset(assetFormat);
  if (!asset) {
    throw new Error(`Cannot parse asset format: ${assetFormat}`);
  }
  return Amount.from(human, asset, layer);
}

/**
 * Quick conversion between layers
 */
export function convert(amount: Amount, targetLayer: Layer): Amount {
  return amount.toLayer(targetLayer);
}