import { getCoinBalance } from '@core/chain/coin/balance'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { Chain } from '@core/chain/Chain'
import { ChainKind } from '@core/chain/ChainKind'
import type { Vault, Balance } from '../types'
import type { WASMManager } from '../wasm/WASMManager'
import { AddressDeriver } from './AddressDeriver'

/**
 * ChainManager handles multi-chain blockchain operations
 * Integrates with WalletCore via WASM for address derivation and operations
 */
export class ChainManager {
  private addressDeriver = new AddressDeriver()

  constructor(private wasmManager: WASMManager) {}

  /**
   * Initialize ChainManager with WalletCore
   */
  async initialize(): Promise<void> {
    const walletCore = await this.wasmManager.getWalletCore()
    await this.addressDeriver.initialize(walletCore)
  }

  /**
   * Get addresses for vault across specific chains
   */
  async getAddresses(vault: Vault, chains: Chain[]): Promise<Record<Chain, string>> {
    const addresses: Record<Chain, string> = {} as any
    
    for (const chain of chains) {
      const chainStr = chain.toLowerCase()
      addresses[chain] = await this.addressDeriver.deriveAddress(vault, chainStr)
    }
    
    return addresses
  }

  /**
   * Get addresses for vault across chain kinds (categories)
   */
  async getAddressesByKind(vault: Vault, chainKinds: ChainKind[]): Promise<Record<ChainKind, string>> {
    const addresses: Record<ChainKind, string> = {} as any
    
    // For each chain kind, get the primary chain's address
    for (const chainKind of chainKinds) {
      const primaryChain = this.getPrimaryChainForKind(chainKind)
      if (primaryChain) {
        const chainStr = primaryChain.toLowerCase()
        addresses[chainKind] = await this.addressDeriver.deriveAddress(vault, chainStr)
      }
    }
    
    return addresses
  }

  /**
   * Get balances for addresses across multiple chains  
   */
  async getBalances(addresses: Record<Chain, string>): Promise<Record<Chain, Balance>> {
    const balances: Record<Chain, Balance> = {} as any
    
    for (const [chain, address] of Object.entries(addresses)) {
      try {
        balances[chain as Chain] = await this.getChainBalance(chain as Chain, address)
      } catch (error) {
        console.error(`Failed to get balance for ${chain}:`, error)
        // Return zero balance on error  
        const feeCoin = chainFeeCoin[chain as Chain]
        balances[chain as Chain] = {
          amount: '0',
          decimals: feeCoin?.decimals || 18,
          symbol: feeCoin?.ticker || chain.toUpperCase()
        }
      }
    }
    
    return balances
  }

  /**
   * Get balances for chain kinds
   */
  async getBalancesByKind(addresses: Record<ChainKind, string>): Promise<Record<ChainKind, Balance>> {
    const balances: Record<ChainKind, Balance> = {} as any
    
    for (const [chainKind, address] of Object.entries(addresses)) {
      try {
        const primaryChain = this.getPrimaryChainForKind(chainKind as ChainKind)
        if (primaryChain) {
          balances[chainKind as ChainKind] = await this.getChainBalance(primaryChain, address)
        }
      } catch (error) {
        console.error(`Failed to get balance for ${chainKind}:`, error)
        // Return zero balance on error
        balances[chainKind as ChainKind] = {
          amount: '0',
          decimals: 18,
          symbol: chainKind.toUpperCase()
        }
      }
    }
    
    return balances
  }

  /**
   * Get chain client for specific blockchain
   */
  getChainClient(chain: Chain) {
    // This could integrate with core chain clients in the future
    throw new Error('getChainClient not implemented yet - requires core chain client integration')
  }

  /**
   * Get primary chain for a chain kind (used for address derivation)
   */
  private getPrimaryChainForKind(chainKind: ChainKind): Chain | null {
    // Map chain kinds to their primary chains
    switch (chainKind) {
      case 'utxo': return Chain.Bitcoin
      case 'evm': return Chain.Ethereum  
      case 'cosmos': return Chain.Cosmos
      case 'solana': return Chain.Solana
      case 'sui': return Chain.Sui
      case 'polkadot': return Chain.Polkadot
      case 'ton': return Chain.Ton
      case 'ripple': return Chain.Ripple
      case 'tron': return Chain.Tron
      case 'cardano': return Chain.Cardano
      default: return null
    }
  }


  /**
   * Get balance for specific chain and address
   */
  private async getChainBalance(chain: Chain, address: string): Promise<Balance> {
    const feeCoin = chainFeeCoin[chain]
    if (!feeCoin) {
      throw new Error(`No fee coin configuration for chain: ${chain}`)
    }

    const accountCoinKey = {
      chain,
      id: feeCoin.id,
      address,
    }

    const balance = await getCoinBalance(accountCoinKey)
    
    return {
      amount: balance.toString(),
      decimals: feeCoin.decimals,
      symbol: feeCoin.ticker,
    }
  }
}