/**
 * Network configuration and asset metadata for Rujira SDK
 * 
 * This module centralizes all network-specific configuration and asset definitions.
 * It provides environment-specific defaults while allowing customization for
 * advanced use cases like private RPC endpoints or custom contract deployments.
 * 
 * Configuration hierarchy:
 * 1. **Network defaults**: Sensible defaults for mainnet/stagenet/localnet
 * 2. **User overrides**: Custom RPC endpoints, gas settings, contract addresses
 * 3. **Runtime discovery**: Dynamic contract discovery for new markets
 * 
 * Asset metadata strategy:
 * - Uses @vultisig/assets for unified asset handling across all packages
 * - Maintains compatibility with FIN contract requirements
 * - Provides proper decimal conversion between layers
 * - Maps denoms to human-readable tickers for UI display
 * 
 * @module config
 */

import { KNOWN_ASSETS, getAsset, findAssetByFormat } from '@vultisig/assets';

/**
 * Network type
 */
export type NetworkType = 'mainnet' | 'stagenet' | 'localnet';

/**
 * Network configuration
 */
export interface NetworkConfig {
  /** Network identifier */
  network: NetworkType;
  /** Chain ID for THORChain */
  chainId: string;
  /** THORChain RPC endpoint */
  rpcEndpoint: string;
  /** THORChain REST/LCD endpoint */
  restEndpoint: string;
  /** Midgard API endpoint */
  midgardEndpoint: string;
  /** Rujira GraphQL WebSocket endpoint */
  graphqlWsEndpoint?: string;
  /** Default gas price */
  gasPrice: string;
  /** Default gas limit (transactions) */
  gasLimit: number;
  /** Default gas limit for CosmWasm smart queries */
  wasmQueryGasLimit: number;
  /** Address prefix */
  addressPrefix: string;
}

/**
 * Known contract addresses/code hashes
 */
export interface ContractRegistry {
  /** rujira-fin (RUJI Trade DEX) code hash */
  finCodeHash: string;
  /** rujira-bow (AMM) code hash */
  bowCodeHash: string;
  /** nami-affiliate code hash */
  affiliateCodeHash: string;
  /** Known FIN contract instances (pair -> address) */
  finContracts: Record<string, string>;
}

/**
 * Full configuration
 */
export interface RujiraConfig extends NetworkConfig {
  /** Contract registry */
  contracts: ContractRegistry;
  /** Default slippage in basis points */
  defaultSlippageBps: number;
  /** Affiliate address (optional) */
  affiliateAddress?: string;
  /** Affiliate fee in basis points */
  affiliateFeeBps?: number;
}

// ============================================================================
// NETWORK CONFIGURATIONS
// ============================================================================

/**
 * Mainnet configuration
 */
export const MAINNET_CONFIG: RujiraConfig = {
  network: 'mainnet',
  chainId: 'thorchain-1',
  rpcEndpoint: 'https://rpc.ninerealms.com',
  restEndpoint: 'https://thornode.ninerealms.com',
  midgardEndpoint: 'https://midgard.ninerealms.com/v2',
  graphqlWsEndpoint: 'wss://api.rujira.network/socket',
  gasPrice: '0.025rune',
  gasLimit: 500000,
  wasmQueryGasLimit: 5_000_000,
  addressPrefix: 'thor',
  contracts: {
    finCodeHash: '240a0994d37b7eb80bf2273c4224c736194160353ba6ccd9ae893eeab88794b9',
    bowCodeHash: 'd77de081ae6440fd46cb4620d5fc9e285f2343f972edc0f70685a4b5f9f49536',
    affiliateCodeHash: '223ea20a4463696fe32b23f845e9f90ae5c83ef0175894a4b0cec114b7dd4b26',
    // Known FIN contract instances - to be populated
    finContracts: {
      // 'rune/btc-btc': 'thor1...',
      // 'rune/eth-eth': 'thor1...',
    },
  },
  defaultSlippageBps: 100, // 1%
};

/**
 * Stagenet configuration
 */
export const STAGENET_CONFIG: RujiraConfig = {
  network: 'stagenet',
  chainId: 'thorchain-stagenet-v2',
  rpcEndpoint: 'https://stagenet-rpc.ninerealms.com',
  restEndpoint: 'https://stagenet-thornode.ninerealms.com',
  midgardEndpoint: 'https://stagenet-midgard.ninerealms.com/v2',
  gasPrice: '0.025rune',
  gasLimit: 500000,
  wasmQueryGasLimit: 5_000_000,
  addressPrefix: 'sthor',
  contracts: {
    finCodeHash: '',
    bowCodeHash: '',
    affiliateCodeHash: '',
    finContracts: {},
  },
  defaultSlippageBps: 100,
};

/**
 * Localnet configuration (for development)
 */
export const LOCALNET_CONFIG: RujiraConfig = {
  network: 'localnet',
  chainId: 'thorchain',
  rpcEndpoint: 'http://localhost:26657',
  restEndpoint: 'http://localhost:1317',
  midgardEndpoint: 'http://localhost:8080/v2',
  gasPrice: '0.025rune',
  gasLimit: 500000,
  wasmQueryGasLimit: 5_000_000,
  addressPrefix: 'thor',
  contracts: {
    finCodeHash: '',
    bowCodeHash: '',
    affiliateCodeHash: '',
    finContracts: {},
  },
  defaultSlippageBps: 100,
};

/**
 * Get configuration for a network
 */
export function getNetworkConfig(network: NetworkType): RujiraConfig {
  switch (network) {
    case 'mainnet':
      return MAINNET_CONFIG;
    case 'stagenet':
      return STAGENET_CONFIG;
    case 'localnet':
      return LOCALNET_CONFIG;
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

// ============================================================================
// ASSET METADATA (using @vultisig/assets)
// ============================================================================

/**
 * Get metadata for an asset denom using @vultisig/assets registry
 * Falls back to sensible defaults for unknown assets
 */
export function getAssetMetadata(denom: string): { decimals: number; chainDecimals: number; ticker: string } {
  const normalized = denom.toLowerCase();
  
  // Try to find the asset by FIN format (single-arg signature searches all formats)
  const asset = findAssetByFormat(normalized);
  if (asset) {
    return {
      decimals: asset.decimals.fin,
      chainDecimals: asset.decimals.thorchain,
      ticker: asset.name.split(' ')[0].toUpperCase()
    };
  }
  
  // Unknown asset - derive ticker from denom and use default decimals
  const ticker = denomToTicker(denom);
  return { decimals: 6, chainDecimals: 8, ticker }; // FIN default: 6 decimals
}

/**
 * Convert denom to short ticker for display using @vultisig/assets
 */
function denomToTicker(denom: string): string {
  // Try to find the asset by FIN format (single-arg signature searches all formats)
  const asset = findAssetByFormat(denom);
  if (asset) {
    return asset.name.split(' ')[0].toUpperCase();
  }
  
  // Fallback to parsing denom format
  const parts = denom.split('-');
  if (parts.length >= 2) {
    return parts[1].toUpperCase();
  }
  
  return denom.toUpperCase();
}

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================
// Deprecated exports removed in favor of @vultisig/assets
// Use: import { getAsset, findAssetByFormat } from '@vultisig/assets';
