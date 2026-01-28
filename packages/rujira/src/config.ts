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
      // 'RUNE/BTC': 'thor1...',
      // 'RUNE/ETH': 'thor1...',
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
// KNOWN ASSETS
// ============================================================================

/**
 * Known secured assets on Rujira
 * Denoms use dash format as per contract spec (e.g., btc-btc not btc/btc)
 */
/**
 * Secured assets on Rujira/THORChain
 * 
 * IMPORTANT: These decimals are for FIN contract interaction, NOT cosmos bank storage.
 * - Cosmos bank stores all secured assets with 8 decimals
 * - FIN contracts use 6 decimals for most assets (tick precision)
 * - When converting cosmos bank balance to FIN contract amounts, divide by 100
 * 
 * The 'finDecimals' field is what FIN contracts expect.
 * The 'chainDecimals' field is what cosmos bank uses (always 8 for secured assets).
 */
export const SECURED_ASSETS: Record<string, { denom: string; decimals: number; chainDecimals?: number }> = {
  'THOR.RUNE': { denom: 'rune', decimals: 8, chainDecimals: 8 },
  'BTC.BTC': { denom: 'btc-btc', decimals: 6, chainDecimals: 8 },
  'ETH.ETH': { denom: 'eth-eth', decimals: 6, chainDecimals: 8 },
  'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48': { denom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, chainDecimals: 8 },
  'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7': { denom: 'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, chainDecimals: 8 },
  'GAIA.ATOM': { denom: 'gaia-atom', decimals: 6, chainDecimals: 8 },
  'AVAX.AVAX': { denom: 'avax-avax', decimals: 6, chainDecimals: 8 },
  'BSC.BNB': { denom: 'bsc-bnb', decimals: 6, chainDecimals: 8 },
  'DOGE.DOGE': { denom: 'doge-doge', decimals: 6, chainDecimals: 8 },
  'LTC.LTC': { denom: 'ltc-ltc', decimals: 6, chainDecimals: 8 },
  'BCH.BCH': { denom: 'bch-bch', decimals: 6, chainDecimals: 8 },
  'THOR.RUJI': { denom: 'thor.ruji', decimals: 8, chainDecimals: 8 },
  'THOR.TCY': { denom: 'thor.tcy', decimals: 8, chainDecimals: 8 },
};

/**
 * Get asset info from asset string
 * Falls back to dynamic conversion for unknown assets
 */
export function getAssetInfo(asset: string): { denom: string; decimals: number } | undefined {
  // Direct lookup
  if (SECURED_ASSETS[asset]) {
    return SECURED_ASSETS[asset];
  }
  
  // Try uppercase
  const upper = asset.toUpperCase();
  if (SECURED_ASSETS[upper]) {
    return SECURED_ASSETS[upper];
  }
  
  // Dynamic conversion for unknown assets
  // Convert: ETH.USDC-0X... -> eth-usdc-0x...
  if (asset.includes('.')) {
    const denom = asset.toLowerCase().replace('.', '-');
    // Default to 8 decimals (common for most assets)
    return { denom, decimals: 8 };
  }
  
  return undefined;
}
