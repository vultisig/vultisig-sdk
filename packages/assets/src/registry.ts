import { Asset } from './asset.js';

/**
 * Registry of known assets with their formats and decimal specifications
 * Complete Rujira asset coverage with correct FIN denom formats
 */
export const KNOWN_ASSETS: Record<string, Asset> = {
  // Native L1 Assets
  btc: {
    id: 'btc',
    name: 'Bitcoin',
    chain: 'bitcoin',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'BTC',
      thorchain: 'BTC.BTC',
      fin: 'btc-btc'
    }
  },
  eth: {
    id: 'eth',
    name: 'Ethereum',
    chain: 'ethereum',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'ETH',
      thorchain: 'ETH.ETH',
      fin: 'eth-eth'
    }
  },
  ltc: {
    id: 'ltc',
    name: 'Litecoin',
    chain: 'litecoin',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'LTC',
      thorchain: 'LTC.LTC',
      fin: 'ltc-ltc'
    }
  },
  bch: {
    id: 'bch',
    name: 'Bitcoin Cash',
    chain: 'bitcoincash',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'BCH',
      thorchain: 'BCH.BCH',
      fin: 'bch-bch'
    }
  },
  doge: {
    id: 'doge',
    name: 'Dogecoin',
    chain: 'dogecoin',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'DOGE',
      thorchain: 'DOGE.DOGE',
      fin: 'doge-doge'
    }
  },
  atom: {
    id: 'atom',
    name: 'Cosmos',
    chain: 'cosmos',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'ATOM',
      thorchain: 'GAIA.ATOM',
      fin: 'gaia-atom'
    }
  },
  avax: {
    id: 'avax',
    name: 'Avalanche',
    chain: 'avalanche',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'AVAX',
      thorchain: 'AVAX.AVAX',
      fin: 'avax-avax'
    }
  },
  bnb: {
    id: 'bnb',
    name: 'BNB Chain',
    chain: 'binance',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'BNB',
      thorchain: 'BNB.BNB',
      fin: 'bsc-bnb'
    }
  },
  xrp: {
    id: 'xrp',
    name: 'XRP Ledger',
    chain: 'xrp',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'XRP',
      thorchain: 'XRP.XRP',
      fin: 'xrp-xrp'
    }
  },
  base_eth: {
    id: 'base_eth',
    name: 'Base (Ethereum L2)',
    chain: 'base',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'ETH',
      thorchain: 'BASE.ETH',
      fin: 'base-eth'
    }
  },

  // THORChain Native Tokens
  rune: {
    id: 'rune',
    name: 'THORChain',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'RUNE',
      thorchain: 'THOR.RUNE',
      fin: 'rune'
    }
  },
  tcy: {
    id: 'tcy',
    name: 'TCY Token',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'TCY',
      thorchain: 'THOR.TCY',
      fin: 'tcy'
    }
  },
  ruji: {
    id: 'ruji',
    name: 'RUJI Token',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'RUJI',
      thorchain: 'THOR.RUJI',
      fin: 'x/ruji'
    }
  },
  auto: {
    id: 'auto',
    name: 'AUTO Token',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'AUTO',
      thorchain: 'THOR.AUTO',
      fin: 'thor.auto'
    }
  },
  lqdy: {
    id: 'lqdy',
    name: 'LQDY Token',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'LQDY',
      thorchain: 'THOR.LQDY',
      fin: 'thor.lqdy'
    }
  },
  nami: {
    id: 'nami',
    name: 'NAMI Token',
    chain: 'thorchain',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: 'NAMI',
      thorchain: 'THOR.NAMI',
      fin: 'thor.nami'
    }
  },

  // Ethereum ERC20 Tokens
  usdc_eth: {
    id: 'usdc_eth',
    name: 'USD Coin (Ethereum)',
    chain: 'ethereum',
    contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      thorchain: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      fin: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    }
  },
  usdt_eth: {
    id: 'usdt_eth',
    name: 'Tether USD (Ethereum)',
    chain: 'ethereum',
    contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      thorchain: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
      fin: 'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7'
    }
  },
  dai: {
    id: 'dai',
    name: 'Dai Stablecoin',
    chain: 'ethereum',
    contract: '0x6b175474e89094c44da98b954eedeac495271d0f',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x6b175474e89094c44da98b954eedeac495271d0f',
      thorchain: 'ETH.DAI-0X6B175474E89094C44DA98B954EEDEAC495271D0F',
      fin: 'eth-dai-0x6b175474e89094c44da98b954eedeac495271d0f'
    }
  },
  gusd: {
    id: 'gusd',
    name: 'Gemini Dollar',
    chain: 'ethereum',
    contract: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
    decimals: {
      native: 2,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
      thorchain: 'ETH.GUSD-0X056FD409E1D7A124BD7017459DFEA2F387B6D5CD',
      fin: 'eth-gusd-0x056fd409e1d7a124bd7017459dfea2f387b6d5cd'
    }
  },
  usdp: {
    id: 'usdp',
    name: 'Pax Dollar',
    chain: 'ethereum',
    contract: '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
      thorchain: 'ETH.USDP-0X8E870D67F660D95D5BE530380D0EC0BD388289E1',
      fin: 'eth-usdp-0x8e870d67f660d95d5be530380d0ec0bd388289e1'
    }
  },

  // Base Chain Tokens
  usdc_base: {
    id: 'usdc_base',
    name: 'USD Coin (Base)',
    chain: 'base',
    contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      thorchain: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913',
      fin: 'base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    }
  },
  cbbtc: {
    id: 'cbbtc',
    name: 'Coinbase Wrapped BTC',
    chain: 'base',
    contract: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
    decimals: {
      native: 8,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      thorchain: 'BASE.CBBTC-0XCBB7C0000AB88B473B1F5AFD9EF808440EED33BF',
      fin: 'base-cbbtc-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    }
  },

  // BSC Tokens
  usdc_bsc: {
    id: 'usdc_bsc',
    name: 'USD Coin (BSC)',
    chain: 'binance',
    contract: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      thorchain: 'BNB.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D',
      fin: 'bsc-usdc-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
    }
  },
  usdt_bsc: {
    id: 'usdt_bsc',
    name: 'Tether USD (BSC)',
    chain: 'binance',
    contract: '0x55d398326f99059ff775485246999027b3197955',
    decimals: {
      native: 18,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x55d398326f99059ff775485246999027b3197955',
      thorchain: 'BNB.USDT-0X55D398326F99059FF775485246999027B3197955',
      fin: 'bsc-usdt-0x55d398326f99059ff775485246999027b3197955'
    }
  },

  // Avalanche Tokens
  usdc_avax: {
    id: 'usdc_avax',
    name: 'USD Coin (Avalanche)',
    chain: 'avalanche',
    contract: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
      thorchain: 'AVAX.USDC-0XB97EF9EF8734C71904D8002F8B6BC66DD9C48A6E',
      fin: 'avax-usdc-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'
    }
  },
  usdt_avax: {
    id: 'usdt_avax',
    name: 'Tether USD (Avalanche)',
    chain: 'avalanche',
    contract: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
      thorchain: 'AVAX.USDT-0X9702230A8EA53601F5CD2DC00FDBC13D4DF4A8C7',
      fin: 'avax-usdt-0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7'
    }
  }
};

/**
 * Get asset by ID
 */
export function getAsset(id: string): Asset | null {
  return KNOWN_ASSETS[id.toLowerCase()] || null;
}

/**
 * Get all known assets
 */
export function getAllAssets(): Asset[] {
  return Object.values(KNOWN_ASSETS);
}

/**
 * Find asset by any format
 */
export function findAssetByFormat(format: string): Asset | null {
  const normalizedFormat = format.toLowerCase();
  
  for (const asset of Object.values(KNOWN_ASSETS)) {
    if (asset.formats.l1.toLowerCase() === normalizedFormat ||
        asset.formats.thorchain.toLowerCase() === normalizedFormat ||
        asset.formats.fin.toLowerCase() === normalizedFormat ||
        asset.id === normalizedFormat) {
      return asset;
    }
  }
  
  return null;
}

/**
 * Get assets by chain
 */
export function getAssetsByChain(chain: string): Asset[] {
  return Object.values(KNOWN_ASSETS).filter(asset => asset.chain === chain);
}

/**
 * Get all supported chains
 */
export function getSupportedChains(): string[] {
  const chains = new Set<string>();
  for (const asset of Object.values(KNOWN_ASSETS)) {
    chains.add(asset.chain);
  }
  return Array.from(chains).sort();
}

/**
 * Get asset statistics
 */
export function getAssetStats() {
  const assets = Object.values(KNOWN_ASSETS);
  const chains = getSupportedChains();
  const nativeAssets = assets.filter(a => !a.contract);
  const tokenAssets = assets.filter(a => a.contract);
  
  return {
    totalAssets: assets.length,
    supportedChains: chains.length,
    nativeAssets: nativeAssets.length,
    tokenAssets: tokenAssets.length,
    chains
  };
}