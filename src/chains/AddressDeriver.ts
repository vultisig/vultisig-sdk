import { Chain } from '../core/chain/Chain'
import { deriveAddress as coreDerive } from '../core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '../core/chain/publicKey/getPublicKey'
import { Vault } from '../core/ui/vault/Vault'

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
        throw new Error(
          'AddressDeriver not initialized. Call initialize() first.'
        )
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
      throw new Error(
        `Failed to derive address for ${chainStr}: ` + (error as Error).message
      )
    }
  }

  mapStringToChain(chainStr: string): Chain {
    // Map common string names to Chain enum values
    // Synchronized with core/chain/Chain.ts and core/chain/coin/coinType.ts
    const chainMap: Record<string, Chain> = {
      // UTXO chains (from UtxoChain enum)
      bitcoin: Chain.Bitcoin,
      btc: Chain.Bitcoin,
      bitcoincash: Chain.BitcoinCash,
      bch: Chain.BitcoinCash,
      litecoin: Chain.Litecoin,
      ltc: Chain.Litecoin,
      dogecoin: Chain.Dogecoin,
      doge: Chain.Dogecoin,
      dash: Chain.Dash,
      zcash: Chain.Zcash,

      // EVM chains (from EvmChain)
      ethereum: Chain.Ethereum,
      eth: Chain.Ethereum,
      arbitrum: Chain.Arbitrum,
      base: Chain.Base,
      blast: Chain.Blast,
      optimism: Chain.Optimism,
      zksync: Chain.Zksync,
      mantle: Chain.Mantle,
      avalanche: Chain.Avalanche,
      avax: Chain.Avalanche,
      cronoschain: Chain.CronosChain,
      cronos: Chain.CronosChain,
      bsc: Chain.BSC,
      bnb: Chain.BSC,
      polygon: Chain.Polygon,
      matic: Chain.Polygon,

      // Cosmos chains (from CosmosChain)
      cosmos: Chain.Cosmos,
      atom: Chain.Cosmos,
      osmosis: Chain.Osmosis,
      osmo: Chain.Osmosis,
      dydx: Chain.Dydx,
      kujira: Chain.Kujira,
      terra: Chain.Terra,
      terraclassic: Chain.TerraClassic,
      noble: Chain.Noble,
      akash: Chain.Akash,
      thorchain: Chain.THORChain,
      thor: Chain.THORChain,
      mayachain: Chain.MayaChain,
      maya: Chain.MayaChain,

      // Other chains (from OtherChain enum)
      sui: Chain.Sui,
      solana: Chain.Solana,
      sol: Chain.Solana,
      polkadot: Chain.Polkadot,
      dot: Chain.Polkadot,
      ton: Chain.Ton,
      ripple: Chain.Ripple,
      xrp: Chain.Ripple,
      tron: Chain.Tron,
      trx: Chain.Tron,
      cardano: Chain.Cardano,
      ada: Chain.Cardano,
    }

    const mappedChain = chainMap[chainStr.toLowerCase()]
    if (!mappedChain) {
      throw new Error(`Unsupported chain: ${chainStr}`)
    }

    return mappedChain
  }

  async deriveMultipleAddresses(
    vault: Vault,
    chains: string[]
  ): Promise<Record<string, string>> {
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
