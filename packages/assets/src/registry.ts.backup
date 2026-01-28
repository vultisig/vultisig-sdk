import { Asset } from './asset.js';

/**
 * Registry of known assets with their formats and decimal specifications
 */
export const KNOWN_ASSETS: Record<string, Asset> = {
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
      fin: 'bitcoin-btc'
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
      fin: 'ethereum-eth'
    }
  },
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
      fin: 'thorchain-rune'
    }
  },
  usdc: {
    id: 'usdc',
    name: 'USD Coin',
    chain: 'ethereum',
    contract: '0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d',
      thorchain: 'ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D',
      fin: 'ethereum-usdc'
    }
  },
  usdt: {
    id: 'usdt',
    name: 'Tether USD',
    chain: 'ethereum',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: {
      native: 6,
      thorchain: 8,
      fin: 6
    },
    formats: {
      l1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      thorchain: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
      fin: 'ethereum-usdt'
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
      fin: 'avalanche-avax'
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
      fin: 'cosmos-atom'
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
      fin: 'dogecoin-doge'
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
      fin: 'litecoin-ltc'
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
      fin: 'bitcoincash-bch'
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
      fin: 'binance-bnb'
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