import { Balance } from '../../types'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { SmartBalanceResolver } from '../balance/blockchair/integration'
import { ChainConfig } from '../../chains/config/ChainConfig'

/**
 * Service for coordinating balance fetching across chains.
 * Integrates Blockchair for faster responses with RPC fallback.
 */
export class BalanceService {

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
        // Map string chain to Chain enum using ChainConfig
        const chainEnum = ChainConfig.getChainEnum(chain)

        // Get raw balance from Blockchair (returns bigint)
        const rawBalance = await this.balanceResolver.getBalance({
          chain: chainEnum,
          address
        })

        // Convert to Balance type
        return this.convertToBalance(chain, rawBalance)
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
   * Uses ChainConfig for decimals and symbol lookup
   * @param chain Chain identifier
   * @param rawBalance Balance in smallest unit (wei, lamports, etc.)
   */
  private convertToBalance(
    chain: string,
    rawBalance: bigint
  ): Balance {
    // Use ChainConfig for chain metadata
    const decimals = ChainConfig.getDecimals(chain)
    const symbol = ChainConfig.getSymbol(chain)

    return {
      amount: rawBalance.toString(),
      decimals,
      symbol
    }
  }
}
