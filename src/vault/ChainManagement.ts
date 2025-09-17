/**
 * ChainManagement handles SDK-level chain configuration and validation
 * Manages supported chains, default chains, and currency settings
 */
export class ChainManagement {
  private defaultChains: string[] = ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
  private defaultCurrency = 'USD'

  constructor(config?: {
    defaultChains?: string[]
    defaultCurrency?: string
  }) {
    if (config?.defaultChains) {
      this.defaultChains = config.defaultChains
    }
    if (config?.defaultCurrency) {
      this.defaultCurrency = config.defaultCurrency
    }
  }

  /**
   * Get all hardcoded supported chains (immutable)
   * Complete list from core/chain/Chain.ts - cannot be overridden at runtime
   */
  getSupportedChains(): string[] {
    return [
      // EVM Chains
      'Ethereum', 'Arbitrum', 'Base', 'Blast', 'Optimism', 'Zksync', 'Mantle',
      'Avalanche', 'CronosChain', 'BSC', 'Polygon',
      
      // UTXO Chains  
      'Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash',
      
      // Cosmos Chains
      'THORChain', 'MayaChain', 'Cosmos', 'Osmosis', 'Dydx', 'Kujira', 
      'Terra', 'TerraClassic', 'Noble', 'Akash',
      
      // Other Chains
      'Sui', 'Solana', 'Polkadot', 'Ton', 'Ripple', 'Tron', 'Cardano'
    ]
  }

  /**
   * Set SDK-level default chains for new vaults
   * Validates against supported chains list
   */
  setDefaultChains(chains: string[]): void {
    const supportedChains = this.getSupportedChains()
    const invalidChains = chains.filter(chain => !supportedChains.includes(chain))
    
    if (invalidChains.length > 0) {
      throw new Error(`Unsupported chains: ${invalidChains.join(', ')}. Supported chains: ${supportedChains.join(', ')}`)
    }
    
    this.defaultChains = chains
    // TODO: Save config to storage
  }

  /**
   * Get SDK-level default chains (5 top chains: BTC, ETH, SOL, THOR, XRP)
   */
  getDefaultChains(): string[] {
    return this.defaultChains
  }

  /**
   * Set global default currency
   */
  setDefaultCurrency(currency: string): void {
    this.defaultCurrency = currency
    // TODO: Save config to storage
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.defaultCurrency
  }
}
