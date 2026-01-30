import { findAssetByFormat } from '@vultisig/assets';

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
  gasPrice: '0.025rune',
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
      ticker: asset.name.split(' ')[0].toUpperCase(),
    };
  }

  const ticker = denomToTicker(denom);
  return { decimals: 6, chainDecimals: 8, ticker };
}

function denomToTicker(denom: string): string {
  const asset = findAssetByFormat(denom);
  if (asset) {
    return asset.name.split(' ')[0].toUpperCase();
  }

  const parts = denom.split('-');
  if (parts.length >= 2) {
    return parts[1].toUpperCase();
  }

  return denom.toUpperCase();
}
