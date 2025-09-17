import type { Balance, ChainKind, Vault } from '../types'
import { Chain } from '../core/chain/Chain'
import type { ChainManager } from '../chains'
import type { AddressDeriver } from '../chains/AddressDeriver'

/**
 * BalanceManagement handles balance-related operations
 * Coordinates with ChainManager and AddressDeriver for balance fetching
 */
export class BalanceManagement {
  constructor(
    private chainManager: ChainManager,
    private addressDeriver: AddressDeriver
  ) {}

  /**
   * Get addresses for vault across specific chains
   */
  async getAddresses(vault: Vault, chains: Chain[]): Promise<Record<Chain, string>> {
    return this.chainManager.getAddresses(vault, chains)
  }

  /**
   * Get addresses for vault across chain kinds (categories)
   */
  async getAddressesByKind(vault: Vault, chainKinds: ChainKind[]): Promise<Record<ChainKind, string>> {
    return this.chainManager.getAddressesByKind(vault, chainKinds)
  }

  /**
   * Get balances for addresses across specific chains
   */
  async getBalances(addresses: Record<Chain, string>): Promise<Record<Chain, Balance>> {
    return this.chainManager.getBalances(addresses)
  }

  /**
   * Get balances for chain kinds
   */
  async getBalancesByKind(addresses: Record<ChainKind, string>): Promise<Record<ChainKind, Balance>> {
    return this.chainManager.getBalancesByKind(addresses)
  }

  /**
   * Get balances for a vault across common chains
   */
  async getVaultBalances(vault: Vault): Promise<Record<string, Balance>> {
    // Define common chains to check
    const commonChains = ['bitcoin', 'ethereum', 'thorchain', 'litecoin']
    
    try {
      // Get addresses for the vault using AddressDeriver
      const addresses = await this.addressDeriver.deriveMultipleAddresses(vault, commonChains)
      
      // Get balances for each address (mock implementation for now)
      const result: Record<string, Balance> = {}
      for (const [chain, address] of Object.entries(addresses)) {
        // For now, return zero balances - balance fetching can be implemented later
        result[chain] = {
          amount: '0',
          decimals: 8,
          symbol: chain.toUpperCase()
        }
      }
      
      return result
    } catch (error) {
      throw new Error(`Failed to get vault balances: ${error}`)
    }
  }

  /**
   * Derive address for a vault on a specific chain
   */
  async deriveAddress(vault: Vault, chain: string): Promise<string> {
    return this.addressDeriver.deriveAddress(vault, chain)
  }

  /**
   * Get chain client for specific blockchain
   */
  getChainClient(chain: Chain) {
    return this.chainManager.getChainClient(chain)
  }
}