import { Chain } from '@core/chain/Chain'

/**
 * Chain type categorization
 */
export type ChainType = 'evm' | 'utxo' | 'cosmos' | 'other'

/**
 * Metadata for a single chain
 */
export interface ChainMetadata {
  /** Official chain identifier */
  id: string
  /** Chain enum value from @core/chain/Chain */
  chainEnum: Chain
  /** Native token decimals */
  decimals: number
  /** Native token symbol */
  symbol: string
  /** Chain type category */
  type: ChainType
  /** Alternative names/aliases for this chain */
  aliases: string[]
}

/**
 * Centralized chain configuration - single source of truth for all chain metadata.
 * Consolidates information previously scattered across:
 * - AddressDeriver.mapStringToChain()
 * - BalanceService.getDecimalsForChain() / getSymbolForChain()
 * - ChainManagement.getSupportedChains()
 * - ChainStrategyFactory registration
 */
export class ChainConfig {
  /**
   * Complete chain metadata registry
   * Key: normalized chain name (lowercase)
   * Value: chain metadata
   */
  private static readonly registry: Record<string, ChainMetadata> = {
    // ========== EVM CHAINS (18 decimals) ==========
    ethereum: {
      id: 'Ethereum',
      chainEnum: Chain.Ethereum,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['eth', 'ethereum'],
    },
    arbitrum: {
      id: 'Arbitrum',
      chainEnum: Chain.Arbitrum,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['arbitrum', 'arb'],
    },
    base: {
      id: 'Base',
      chainEnum: Chain.Base,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['base'],
    },
    blast: {
      id: 'Blast',
      chainEnum: Chain.Blast,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['blast'],
    },
    optimism: {
      id: 'Optimism',
      chainEnum: Chain.Optimism,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['optimism', 'op'],
    },
    zksync: {
      id: 'Zksync',
      chainEnum: Chain.Zksync,
      decimals: 18,
      symbol: 'ETH',
      type: 'evm',
      aliases: ['zksync'],
    },
    mantle: {
      id: 'Mantle',
      chainEnum: Chain.Mantle,
      decimals: 18,
      symbol: 'MNT',
      type: 'evm',
      aliases: ['mantle'],
    },
    avalanche: {
      id: 'Avalanche',
      chainEnum: Chain.Avalanche,
      decimals: 18,
      symbol: 'AVAX',
      type: 'evm',
      aliases: ['avalanche', 'avax'],
    },
    cronoschain: {
      id: 'CronosChain',
      chainEnum: Chain.CronosChain,
      decimals: 18,
      symbol: 'CRO',
      type: 'evm',
      aliases: ['cronoschain', 'cronos'],
    },
    bsc: {
      id: 'BSC',
      chainEnum: Chain.BSC,
      decimals: 18,
      symbol: 'BNB',
      type: 'evm',
      aliases: ['bsc', 'bnb', 'binance'],
    },
    polygon: {
      id: 'Polygon',
      chainEnum: Chain.Polygon,
      decimals: 18,
      symbol: 'MATIC',
      type: 'evm',
      aliases: ['polygon', 'matic'],
    },

    // ========== UTXO CHAINS (8 decimals) ==========
    bitcoin: {
      id: 'Bitcoin',
      chainEnum: Chain.Bitcoin,
      decimals: 8,
      symbol: 'BTC',
      type: 'utxo',
      aliases: ['bitcoin', 'btc'],
    },
    'bitcoin-cash': {
      id: 'Bitcoin-Cash',
      chainEnum: Chain.BitcoinCash,
      decimals: 8,
      symbol: 'BCH',
      type: 'utxo',
      aliases: ['bitcoin-cash', 'bitcoincash', 'bch'],
    },
    litecoin: {
      id: 'Litecoin',
      chainEnum: Chain.Litecoin,
      decimals: 8,
      symbol: 'LTC',
      type: 'utxo',
      aliases: ['litecoin', 'ltc'],
    },
    dogecoin: {
      id: 'Dogecoin',
      chainEnum: Chain.Dogecoin,
      decimals: 8,
      symbol: 'DOGE',
      type: 'utxo',
      aliases: ['dogecoin', 'doge'],
    },
    dash: {
      id: 'Dash',
      chainEnum: Chain.Dash,
      decimals: 8,
      symbol: 'DASH',
      type: 'utxo',
      aliases: ['dash'],
    },
    zcash: {
      id: 'Zcash',
      chainEnum: Chain.Zcash,
      decimals: 8,
      symbol: 'ZEC',
      type: 'utxo',
      aliases: ['zcash', 'zec'],
    },

    // ========== COSMOS CHAINS (6 decimals) ==========
    thorchain: {
      id: 'THORChain',
      chainEnum: Chain.THORChain,
      decimals: 8,
      symbol: 'RUNE',
      type: 'cosmos',
      aliases: ['thorchain', 'thor', 'rune'],
    },
    mayachain: {
      id: 'MayaChain',
      chainEnum: Chain.MayaChain,
      decimals: 10,
      symbol: 'CACAO',
      type: 'cosmos',
      aliases: ['mayachain', 'maya', 'cacao'],
    },
    cosmos: {
      id: 'Cosmos',
      chainEnum: Chain.Cosmos,
      decimals: 6,
      symbol: 'ATOM',
      type: 'cosmos',
      aliases: ['cosmos', 'atom'],
    },
    osmosis: {
      id: 'Osmosis',
      chainEnum: Chain.Osmosis,
      decimals: 6,
      symbol: 'OSMO',
      type: 'cosmos',
      aliases: ['osmosis', 'osmo'],
    },
    dydx: {
      id: 'Dydx',
      chainEnum: Chain.Dydx,
      decimals: 18,
      symbol: 'DYDX',
      type: 'cosmos',
      aliases: ['dydx'],
    },
    kujira: {
      id: 'Kujira',
      chainEnum: Chain.Kujira,
      decimals: 6,
      symbol: 'KUJI',
      type: 'cosmos',
      aliases: ['kujira', 'kuji'],
    },
    terra: {
      id: 'Terra',
      chainEnum: Chain.Terra,
      decimals: 6,
      symbol: 'LUNA',
      type: 'cosmos',
      aliases: ['terra', 'luna'],
    },
    terraclassic: {
      id: 'TerraClassic',
      chainEnum: Chain.TerraClassic,
      decimals: 6,
      symbol: 'LUNC',
      type: 'cosmos',
      aliases: ['terraclassic', 'lunc'],
    },
    noble: {
      id: 'Noble',
      chainEnum: Chain.Noble,
      decimals: 6,
      symbol: 'NOBLE',
      type: 'cosmos',
      aliases: ['noble'],
    },
    akash: {
      id: 'Akash',
      chainEnum: Chain.Akash,
      decimals: 6,
      symbol: 'AKT',
      type: 'cosmos',
      aliases: ['akash', 'akt'],
    },

    // ========== OTHER CHAINS ==========
    sui: {
      id: 'Sui',
      chainEnum: Chain.Sui,
      decimals: 9,
      symbol: 'SUI',
      type: 'other',
      aliases: ['sui'],
    },
    solana: {
      id: 'Solana',
      chainEnum: Chain.Solana,
      decimals: 9,
      symbol: 'SOL',
      type: 'other',
      aliases: ['solana', 'sol'],
    },
    polkadot: {
      id: 'Polkadot',
      chainEnum: Chain.Polkadot,
      decimals: 10,
      symbol: 'DOT',
      type: 'other',
      aliases: ['polkadot', 'dot'],
    },
    ton: {
      id: 'Ton',
      chainEnum: Chain.Ton,
      decimals: 9,
      symbol: 'TON',
      type: 'other',
      aliases: ['ton'],
    },
    ripple: {
      id: 'Ripple',
      chainEnum: Chain.Ripple,
      decimals: 6,
      symbol: 'XRP',
      type: 'other',
      aliases: ['ripple', 'xrp'],
    },
    tron: {
      id: 'Tron',
      chainEnum: Chain.Tron,
      decimals: 6,
      symbol: 'TRX',
      type: 'other',
      aliases: ['tron', 'trx'],
    },
    cardano: {
      id: 'Cardano',
      chainEnum: Chain.Cardano,
      decimals: 6,
      symbol: 'ADA',
      type: 'other',
      aliases: ['cardano', 'ada'],
    },
  }

  /**
   * Get chain metadata by chain identifier (case-insensitive)
   * @param chainId Chain identifier (e.g., 'Ethereum', 'eth', 'bitcoin', 'BTC')
   * @returns Chain metadata
   * @throws Error if chain not supported
   */
  static getMetadata(chainId: string): ChainMetadata {
    const normalized = chainId.toLowerCase()

    // Direct lookup
    const direct = this.registry[normalized]
    if (direct) {
      return direct
    }

    // Search by alias
    for (const metadata of Object.values(this.registry)) {
      if (metadata.aliases.includes(normalized)) {
        return metadata
      }
    }

    throw new Error(
      `Unsupported chain: ${chainId}. Supported chains: ${this.getSupportedChains().join(', ')}`
    )
  }

  /**
   * Map chain string to Chain enum value
   * Replaces AddressDeriver.mapStringToChain()
   * @param chainId Chain identifier
   * @returns Chain enum value
   */
  static getChainEnum(chainId: string): Chain {
    return this.getMetadata(chainId).chainEnum
  }

  /**
   * Get decimals for a chain
   * Replaces BalanceService.getDecimalsForChain()
   * @param chainId Chain identifier
   * @returns Number of decimals
   */
  static getDecimals(chainId: string): number {
    return this.getMetadata(chainId).decimals
  }

  /**
   * Get native token symbol for a chain
   * Replaces BalanceService.getSymbolForChain()
   * @param chainId Chain identifier
   * @returns Token symbol
   */
  static getSymbol(chainId: string): string {
    return this.getMetadata(chainId).symbol
  }

  /**
   * Get chain type (evm, utxo, cosmos, other)
   * @param chainId Chain identifier
   * @returns Chain type
   */
  static getType(chainId: string): ChainType {
    return this.getMetadata(chainId).type
  }

  /**
   * Get official chain ID (normalized name)
   * @param chainId Any valid chain identifier or alias
   * @returns Official chain ID
   */
  static getChainId(chainId: string): string {
    return this.getMetadata(chainId).id
  }

  /**
   * Get all supported chain IDs (official names)
   * Replaces ChainManagement.getSupportedChains()
   * @returns Array of supported chain identifiers
   */
  static getSupportedChains(): string[] {
    // Return unique official chain IDs (not aliases)
    return Array.from(
      new Set(Object.values(this.registry).map(m => m.id))
    )
  }

  /**
   * Get all chains of a specific type
   * @param type Chain type to filter by
   * @returns Array of chain IDs of that type
   */
  static getChainsByType(type: ChainType): string[] {
    return Object.values(this.registry)
      .filter(m => m.type === type)
      .map(m => m.id)
  }

  /**
   * Get all EVM chain IDs
   * Replaces hardcoded list in ChainStrategyFactory
   * @returns Array of EVM chain identifiers
   */
  static getEvmChains(): string[] {
    return this.getChainsByType('evm')
  }

  /**
   * Get all UTXO chain IDs
   * Replaces hardcoded list in ChainStrategyFactory
   * @returns Array of UTXO chain identifiers
   */
  static getUtxoChains(): string[] {
    return this.getChainsByType('utxo')
  }

  /**
   * Get all Cosmos chain IDs
   * @returns Array of Cosmos chain identifiers
   */
  static getCosmosChains(): string[] {
    return this.getChainsByType('cosmos')
  }

  /**
   * Check if a chain is supported
   * @param chainId Chain identifier (can be alias)
   * @returns True if supported, false otherwise
   */
  static isSupported(chainId: string): boolean {
    try {
      this.getMetadata(chainId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if a chain is an EVM chain
   * @param chainId Chain identifier
   * @returns True if EVM chain
   */
  static isEvmChain(chainId: string): boolean {
    return this.getType(chainId) === 'evm'
  }

  /**
   * Check if a chain is a UTXO chain
   * @param chainId Chain identifier
   * @returns True if UTXO chain
   */
  static isUtxoChain(chainId: string): boolean {
    return this.getType(chainId) === 'utxo'
  }

  /**
   * Check if a chain is a Cosmos chain
   * @param chainId Chain identifier
   * @returns True if Cosmos chain
   */
  static isCosmosChain(chainId: string): boolean {
    return this.getType(chainId) === 'cosmos'
  }

  /**
   * Validate chain identifiers against supported chains
   * @param chainIds Array of chain identifiers to validate
   * @returns Object with valid chains and invalid chains
   */
  static validateChains(chainIds: string[]): {
    valid: string[]
    invalid: string[]
  } {
    const valid: string[] = []
    const invalid: string[] = []

    for (const chainId of chainIds) {
      if (this.isSupported(chainId)) {
        valid.push(this.getChainId(chainId)) // Normalize to official ID
      } else {
        invalid.push(chainId)
      }
    }

    return { valid, invalid }
  }

  /**
   * Get default chains for new vaults
   * Returns the top 5 most commonly used chains
   * @returns Array of default chain identifiers
   */
  static getDefaultChains(): string[] {
    return ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
  }
}
