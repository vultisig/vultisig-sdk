/**
 * Network configuration for Rujira SDK
 * @module config
 */

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
  /** Default gas limit */
  gasLimit: number;
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
// ASSET METADATA
// ============================================================================

/**
 * Asset metadata for known denoms
 * 
 * Keys are on-chain denoms (lowercase, hyphen-separated)
 * 
 * Decimals note:
 * - 'decimals' is FIN contract precision (usually 6 for most assets)
 * - 'chainDecimals' is Cosmos bank storage (always 8 for secured assets)
 */
export const ASSET_METADATA: Record<string, { decimals: number; chainDecimals: number; ticker: string }> = {
  // THORChain native
  'rune': { decimals: 8, chainDecimals: 8, ticker: 'RUNE' },
  'tcy': { decimals: 8, chainDecimals: 8, ticker: 'TCY' },
  'ruji': { decimals: 8, chainDecimals: 8, ticker: 'RUJI' },
  
  // Native L1 assets (secured on THORChain)
  'btc-btc': { decimals: 8, chainDecimals: 8, ticker: 'BTC' },
  'eth-eth': { decimals: 8, chainDecimals: 8, ticker: 'ETH' },
  'gaia-atom': { decimals: 6, chainDecimals: 8, ticker: 'ATOM' },
  'avax-avax': { decimals: 8, chainDecimals: 8, ticker: 'AVAX' },
  'bsc-bnb': { decimals: 8, chainDecimals: 8, ticker: 'BNB' },
  'doge-doge': { decimals: 8, chainDecimals: 8, ticker: 'DOGE' },
  'ltc-ltc': { decimals: 8, chainDecimals: 8, ticker: 'LTC' },
  'bch-bch': { decimals: 8, chainDecimals: 8, ticker: 'BCH' },
  
  // ERC20 tokens (secured on THORChain)
  'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { decimals: 6, chainDecimals: 8, ticker: 'USDC' },
  'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7': { decimals: 6, chainDecimals: 8, ticker: 'USDT' },
};

/**
 * Get metadata for an asset denom
 * Falls back to sensible defaults for unknown assets
 */
export function getAssetMetadata(denom: string): { decimals: number; chainDecimals: number; ticker: string } {
  const normalized = denom.toLowerCase();
  
  if (ASSET_METADATA[normalized]) {
    return ASSET_METADATA[normalized];
  }
  
  // Unknown asset - derive ticker from denom and use default decimals
  const ticker = denomToTicker(denom);
  return { decimals: 8, chainDecimals: 8, ticker };
}

/**
 * Convert denom to short ticker for display
 */
function denomToTicker(denom: string): string {
  if (denom === 'rune') return 'RUNE';
  if (denom === 'tcy') return 'TCY';
  if (denom === 'ruji') return 'RUJI';
  
  // Handle chain-asset format: btc-btc -> BTC, eth-usdc-0x... -> USDC
  const parts = denom.split('-');
  if (parts.length >= 2) {
    return parts[1].toUpperCase();
  }
  
  return denom.toUpperCase();
}

// ============================================================================
// LEGACY COMPATIBILITY (deprecated, use ASSET_METADATA)
// ============================================================================

/**
 * @deprecated Use ASSET_METADATA instead. Will be removed in v1.0.
 */
export const SECURED_ASSETS = ASSET_METADATA;

/**
 * @deprecated Use getAssetMetadata instead. Will be removed in v1.0.
 */
export function getAssetInfo(asset: string): { denom: string; decimals: number } | undefined {
  const normalized = asset.toLowerCase();
  const meta = ASSET_METADATA[normalized];
  if (meta) {
    return { denom: normalized, decimals: meta.decimals };
  }
  return { denom: normalized, decimals: 8 };
}
