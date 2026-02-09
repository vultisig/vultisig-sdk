import { findAssetByFormat } from '@vultisig/assets';
import { DEFAULT_GAS_PRICE } from './config/constants.js';
import { denomToTicker } from './utils/denom-conversion.js';

/**
 * Rujira SDK is mainnet-only.
 */
export type NetworkType = 'mainnet';

export interface NetworkConfig {
  network: NetworkType;
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  midgardEndpoint: string;
  graphqlWsEndpoint?: string;
  gasPrice: string;
  gasLimit: number;
  wasmQueryGasLimit: number;
  addressPrefix: string;
}

export interface ContractRegistry {
  finCodeId: number;
  finCodeHash: string;
  bowCodeHash: string;
  affiliateCodeHash: string;
  finContracts: Record<string, string>;
}

export interface RujiraConfig extends NetworkConfig {
  contracts: ContractRegistry;
  defaultSlippageBps: number;
  affiliateAddress?: string;
  affiliateFeeBps?: number;
}

export const MAINNET_CONFIG: RujiraConfig = {
  network: 'mainnet',
  chainId: 'thorchain-1',
  rpcEndpoint: 'https://rpc.ninerealms.com',
  restEndpoint: 'https://thornode.ninerealms.com',
  midgardEndpoint: 'https://midgard.ninerealms.com/v2',
  graphqlWsEndpoint: 'wss://api.rujira.network/socket',
  gasPrice: DEFAULT_GAS_PRICE,
  gasLimit: 500000,
  wasmQueryGasLimit: 5_000_000,
  addressPrefix: 'thor',
  contracts: {
    finCodeId: 73,
    finCodeHash: '240a0994d37b7eb80bf2273c4224c736194160353ba6ccd9ae893eeab88794b9',
    bowCodeHash: 'd77de081ae6440fd46cb4620d5fc9e285f2343f972edc0f70685a4b5f9f49536',
    affiliateCodeHash: '223ea20a4463696fe32b23f845e9f90ae5c83ef0175894a4b0cec114b7dd4b26',
    finContracts: {},
  },
  defaultSlippageBps: 100,
};

/** Maps THORChain chain identifiers to SDK chain names */
export const THORCHAIN_TO_SDK_CHAIN: Record<string, string> = {
  ETH: 'Ethereum',
  BTC: 'Bitcoin',
  BCH: 'BitcoinCash',
  DOGE: 'Dogecoin',
  LTC: 'Litecoin',
  AVAX: 'Avalanche',
  BSC: 'BSC',
  GAIA: 'Cosmos',
  THOR: 'THORChain',
  MAYA: 'MayaChain',
  KUJI: 'Kujira',
  DASH: 'Dash',
  ARB: 'Arbitrum',
  ZEC: 'Zcash',
  XRP: 'Ripple',
  BASE: 'Base',
  TRON: 'Tron',
  NOBLE: 'Noble',
};

/** Estimated processing times per chain in minutes (deposit/withdrawal) */
export const CHAIN_PROCESSING_TIMES: Record<string, number> = {
  BTC: 30,    // ~3 confirmations
  ETH: 5,     // ~12 confirmations
  BSC: 2,     // Fast finality
  AVAX: 1,    // Sub-second finality
  GAIA: 2,    // Cosmos ~6 seconds
  DOGE: 20,   // ~3 confirmations
  LTC: 15,    // ~3 confirmations
  BCH: 20,    // ~3 confirmations
  THOR: 0,    // Native, instant
};

export function getNetworkConfig(_network: NetworkType = 'mainnet'): RujiraConfig {
  return MAINNET_CONFIG;
}

export function getAssetMetadata(denom: string): { decimals: number; chainDecimals: number; ticker: string } {
  const normalized = denom.toLowerCase();

  const asset = findAssetByFormat(normalized);
  if (asset) {
    return {
      decimals: asset.decimals.fin,
      chainDecimals: asset.decimals.thorchain,
      ticker: asset.id.toUpperCase(),
    };
  }

  const ticker = denomToTicker(denom);
  return { decimals: 6, chainDecimals: 8, ticker };
}

