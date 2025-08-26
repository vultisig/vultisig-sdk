import { Vault } from '@core/ui/vault/Vault'
import { Chain } from '@core/chain/Chain'
import { deriveAddress as coreDerive } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'

export class AddressDeriver {
  private walletCore: any = null
  private initialized: boolean = false

  async initialize(walletCore: any): Promise<void> {
    this.walletCore = walletCore
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized && this.walletCore !== null
  }

  async deriveAddress(vault: Vault, chainStr: string): Promise<string> {
    try {
      if (!this.walletCore) {
        throw new Error('AddressDeriver not initialized. Call initialize() first.')
      }

      // Map string to Chain enum
      const chain = this.mapStringToChain(chainStr)
      
      // Get the proper public key for this chain
      const publicKey = getPublicKey({
        chain,
        walletCore: this.walletCore as any,
        hexChainCode: vault.hexChainCode,
        publicKeys: vault.publicKeys,
      })

      // Derive the address using core functionality
      const address = coreDerive({
        chain,
        publicKey,
        walletCore: this.walletCore as any,
      })
      
      return address
    } catch (error) {
      throw new Error(`Failed to derive address for ${chainStr}: ` + (error as Error).message)
    }
  }

  private mapStringToChain(chainStr: string): Chain {
    // Map common string names to Chain enum values
    const chainMap: Record<string, Chain> = {
      'ethereum': Chain.Ethereum,
      'bitcoin': Chain.Bitcoin,
      'cosmos': Chain.Cosmos,
      'thorchain': Chain.THORChain,
      'solana': Chain.Solana,
      'polkadot': Chain.Polkadot,
      'ripple': Chain.Ripple,
      'bsc': Chain.BSC,
      'polygon': Chain.Polygon,
      'avalanche': Chain.Avalanche,
      'arbitrum': Chain.Arbitrum,
      'optimism': Chain.Optimism,
      'mayachain': Chain.MayaChain,
      'cardano': Chain.Cardano,
      'tron': Chain.Tron,
      'ton': Chain.Ton,
      'litecoin': Chain.Litecoin,
      'dogecoin': Chain.Dogecoin,
      'dash': Chain.Dash,
      'zcash': Chain.Zcash,
      'bitcoincash': Chain.BitcoinCash,
      'sui': Chain.Sui,
      'osmosis': Chain.Osmosis,
      'kujira': Chain.Kujira,
      'dydx': Chain.Dydx,
      'terra': Chain.Terra,
      'terraclassic': Chain.TerraClassic,
      'noble': Chain.Noble,
      'akash': Chain.Akash
    }
    
    const mappedChain = chainMap[chainStr.toLowerCase()]
    if (!mappedChain) {
      throw new Error(`Unsupported chain: ${chainStr}`)
    }
    
    return mappedChain
  }


  async deriveMultipleAddresses(vault: Vault, chains: string[]): Promise<Record<string, string>> {
    const addresses: Record<string, string> = {}
    
    for (const chain of chains) {
      try {
        addresses[chain] = await this.deriveAddress(vault, chain)
      } catch (error) {
        console.warn(`Failed to derive address for ${chain}:`, error)
      }
    }
    
    return addresses
  }
}