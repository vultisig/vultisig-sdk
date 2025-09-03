import { VaultData } from '../vault/VaultLoader'
import { initWasm, WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@core/chain/Chain'
import { getChainKind } from '@core/chain/ChainKind'
import { getCoinType } from '@core/chain/coin/coinType'
import { signatureAlgorithms } from '@core/chain/signing/SignatureAlgorithm'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { match } from '@lib/utils/match'

export interface DerivedAddresses {
  [chainName: string]: string
}

export type SupportedChain = 
  | 'btc' | 'eth' | 'sol' | 'ltc' | 'doge' | 'avax' | 'matic' | 'bsc' 
  | 'opt' | 'arb' | 'base' | 'thor' | 'atom' | 'maya' | 'ada' 
  | 'dot' | 'xrp' | 'trx' | 'sui' | 'ton'

export const CHAIN_NAMES: Record<SupportedChain, string> = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  sol: 'Solana',
  ltc: 'Litecoin',
  doge: 'Dogecoin',
  avax: 'Avalanche',
  matic: 'Polygon',
  bsc: 'BSC',
  opt: 'Optimism',
  arb: 'Arbitrum',
  base: 'Base',
  thor: 'THORChain',
  atom: 'Cosmos',
  maya: 'MayaChain',
  ada: 'Cardano',
  dot: 'Polkadot',
  xrp: 'Ripple',
  trx: 'Tron',
  sui: 'Sui',
  ton: 'Ton'
}

// Map CLI chain names to Chain enum values
const CHAIN_MAPPING: Record<SupportedChain, Chain> = {
  btc: Chain.Bitcoin,
  eth: Chain.Ethereum,
  sol: Chain.Solana,
  ltc: Chain.Litecoin,
  doge: Chain.Dogecoin,
  avax: Chain.Avalanche,
  matic: Chain.Polygon,
  bsc: Chain.BSC,
  opt: Chain.Optimism,
  arb: Chain.Arbitrum,
  base: Chain.Base,
  thor: Chain.THORChain,
  atom: Chain.Cosmos,
  maya: Chain.MayaChain,
  ada: Chain.Cardano,
  dot: Chain.Polkadot,
  xrp: Chain.Ripple,
  trx: Chain.Tron,
  sui: Chain.Sui,
  ton: Chain.Ton
}

export const ECDSA_CHAINS: SupportedChain[] = [
  'btc', 'eth', 'ltc', 'doge', 'avax', 'matic', 'bsc', 'opt', 
  'arb', 'base', 'thor', 'atom', 'maya', 'xrp', 'trx'
]
export const EDDSA_CHAINS: SupportedChain[] = ['sol', 'ada', 'dot', 'sui', 'ton']

export class AddressDeriver {
  private walletCore: WalletCore | null = null
  
  async initialize(): Promise<void> {
    if (!this.walletCore) {
      this.walletCore = await initWasm()
    }
  }
  
  async deriveAddresses(vault: VaultData, requestedChains: SupportedChain[] = ['btc', 'eth', 'sol']): Promise<DerivedAddresses> {
    await this.initialize()
    
    if (!this.walletCore) {
      throw new Error('Failed to initialize Trust Wallet Core')
    }
    
    const addresses: DerivedAddresses = {}
    
    for (const chainKey of requestedChains) {
      try {
        const address = await this.deriveAddressForChain(vault, chainKey)
        addresses[CHAIN_NAMES[chainKey]] = address
      } catch (error) {
        console.warn(`Failed to derive address for ${chainKey}:`, error)
        addresses[CHAIN_NAMES[chainKey]] = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
    
    return addresses
  }
  
  private async deriveAddressForChain(vault: VaultData, chainKey: SupportedChain): Promise<string> {
    if (!this.walletCore) {
      throw new Error('Trust Wallet Core not initialized')
    }
    
    const chain = CHAIN_MAPPING[chainKey]
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainKey}`)
    }
    
    // Convert vault data to the format expected by core functions
    const publicKeys = {
      ecdsa: vault.publicKeyEcdsa,
      eddsa: vault.publicKeyEddsa
    }
    
    // Use the existing core function to get the derived public key
    const publicKey = getPublicKey({
      chain,
      walletCore: this.walletCore,
      hexChainCode: vault.hexChainCode,
      publicKeys
    })
    
    // Use the existing core function to derive the address
    const address = deriveAddress({
      chain,
      publicKey,
      walletCore: this.walletCore
    })
    
    return address
  }
  
  async deriveAddressForSingleChain(vault: VaultData, chainKey: SupportedChain): Promise<string> {
    return this.deriveAddressForChain(vault, chainKey)
  }
  
  // Helper method to check which algorithm a chain uses
  getSignatureAlgorithm(chainKey: SupportedChain): 'ecdsa' | 'eddsa' {
    const chain = CHAIN_MAPPING[chainKey]
    const chainKind = getChainKind(chain)
    return signatureAlgorithms[chainKind]
  }
  
  // Helper method to validate that vault has the required keys for a chain
  validateVaultForChain(vault: VaultData, chainKey: SupportedChain): boolean {
    const algorithm = this.getSignatureAlgorithm(chainKey)
    
    if (algorithm === 'ecdsa') {
      return !!vault.publicKeyEcdsa && !!vault.hexChainCode
    } else {
      return !!vault.publicKeyEddsa
    }
  }
}

export function parseNetworksString(networks: string): SupportedChain[] {
  if (networks === 'all') {
    return Object.keys(CHAIN_NAMES) as SupportedChain[]
  }
  
  return networks
    .split(',')
    .map(n => n.trim().toLowerCase() as SupportedChain)
    .filter(n => n in CHAIN_NAMES)
}