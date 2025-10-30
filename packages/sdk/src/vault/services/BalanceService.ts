import { Balance } from '../../types'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { SmartBalanceResolver } from '../balance/blockchair/integration'
import { Chain } from '@core/chain/Chain'
import { AddressDeriver } from '../../chains/AddressDeriver'

/**
 * Service for coordinating balance fetching across chains.
 * Integrates Blockchair for faster responses with RPC fallback.
 */
export class BalanceService {
  private addressDeriver = new AddressDeriver()

  constructor(
    private strategyFactory: ChainStrategyFactory,
    private balanceResolver?: SmartBalanceResolver
  ) {}

  /**
   * Fetch balance for an address on a specific chain
   * Uses Blockchair if available, falls back to strategy implementation
   * @param chain Chain identifier (string like 'Ethereum', 'Solana')
   * @param address Address to check
   */
  async fetchBalance(chain: string, address: string): Promise<Balance> {
    // If we have a balance resolver (Blockchair), use it
    if (this.balanceResolver) {
      try {
        // Map string chain to Chain enum
        const chainEnum = this.addressDeriver.mapStringToChain(chain)

        // Get raw balance from Blockchair (returns bigint)
        const rawBalance = await this.balanceResolver.getBalance({
          chain: chainEnum,
          address
        })

        // Convert to Balance type
        return this.convertToBalance(chain, rawBalance, address)
      } catch (error) {
        console.warn(
          `Blockchair balance fetch failed for ${chain}:${address}, falling back to RPC:`,
          error
        )
        // Fall through to strategy method
      }
    }

    // Fallback to strategy implementation (uses direct RPC)
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.getBalance(address)
  }

  /**
   * Fetch balances for multiple chains
   * @param addresses Map of chain to address
   */
  async fetchBalances(
    addresses: Record<string, string>
  ): Promise<Record<string, Balance>> {
    const balances: Record<string, Balance> = {}

    // Fetch in parallel
    await Promise.all(
      Object.entries(addresses).map(async ([chain, address]) => {
        try {
          balances[chain] = await this.fetchBalance(chain, address)
        } catch (error) {
          console.error(`Failed to fetch balance for ${chain}:`, error)
          // Return zero balance on error
          balances[chain] = {
            amount: '0',
            decimals: 18,
            symbol: chain
          }
        }
      })
    )

    return balances
  }

  /**
   * Set or update the balance resolver (for Blockchair configuration)
   * @param resolver New balance resolver
   */
  setBalanceResolver(resolver: SmartBalanceResolver): void {
    this.balanceResolver = resolver
  }

  /**
   * Convert raw balance (bigint) to Balance type
   * @param chain Chain identifier
   * @param rawBalance Balance in smallest unit (wei, lamports, etc.)
   * @param address Address (for logging)
   */
  private convertToBalance(
    chain: string,
    rawBalance: bigint,
    address: string
  ): Balance {
    // TODO: Get proper decimals and symbol from chain config
    // For now, use defaults based on chain
    const decimals = this.getDecimalsForChain(chain)
    const symbol = this.getSymbolForChain(chain)

    return {
      amount: rawBalance.toString(),
      decimals,
      symbol
    }
  }

  /**
   * Get decimal places for a chain
   * TODO: Move to chain config/strategy
   */
  private getDecimalsForChain(chain: string): number {
    const chainLower = chain.toLowerCase()

    // Solana uses 9 decimals
    if (chainLower === 'solana') return 9

    // Bitcoin and most UTXO chains use 8 decimals
    if (['bitcoin', 'litecoin', 'dogecoin', 'bitcoincash', 'dash', 'zcash'].includes(chainLower)) {
      return 8
    }

    // EVM chains typically use 18 decimals
    return 18
  }

  /**
   * Get native token symbol for a chain
   * TODO: Move to chain config/strategy
   */
  private getSymbolForChain(chain: string): string {
    const symbolMap: Record<string, string> = {
      ethereum: 'ETH',
      arbitrum: 'ETH',
      base: 'ETH',
      blast: 'ETH',
      optimism: 'ETH',
      zksync: 'ETH',
      mantle: 'MNT',
      avalanche: 'AVAX',
      cronoschain: 'CRO',
      bsc: 'BNB',
      polygon: 'MATIC',
      solana: 'SOL',
      bitcoin: 'BTC',
      litecoin: 'LTC',
      dogecoin: 'DOGE',
      bitcoincash: 'BCH',
      dash: 'DASH',
      zcash: 'ZEC',
    }

    return symbolMap[chain.toLowerCase()] || chain.toUpperCase()
  }
}
