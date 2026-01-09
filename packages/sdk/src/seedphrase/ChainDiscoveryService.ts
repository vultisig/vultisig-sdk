/**
 * ChainDiscoveryService - Scans chains for existing balances
 *
 * Derives addresses from a mnemonic and checks for non-zero balances
 * to help users identify which chains they have funds on.
 */
import { Chain } from '@core/chain/Chain'
import { getCoinBalance } from '@core/chain/coin/balance'

import { SUPPORTED_CHAINS } from '../constants'
import type { WasmProvider } from '../context/SdkContext'
import { MasterKeyDeriver } from './MasterKeyDeriver'
import type { ChainDiscoveryProgress, ChainDiscoveryResult } from './types'

/**
 * Configuration for chain discovery
 */
export type ChainDiscoveryConfig = {
  /** Maximum concurrent balance requests (default: 5) */
  concurrencyLimit?: number
  /** Chains to scan (default: SUPPORTED_CHAINS) */
  chains?: Chain[]
  /** Timeout per chain in ms (default: 10000) */
  timeoutPerChain?: number
}

/**
 * Chains that use EdDSA signature algorithm
 */
const EDDSA_CHAINS: Chain[] = [Chain.Solana, Chain.Sui, Chain.Polkadot, Chain.Ton, Chain.Cardano]

/**
 * ChainDiscoveryService - Scans blockchains for existing balances
 *
 * Given a mnemonic, this service:
 * 1. Derives addresses for each supported chain
 * 2. Fetches native token balances
 * 3. Reports chains with non-zero balances
 *
 * Useful for showing users which chains have funds before import.
 *
 * @example
 * ```typescript
 * const discovery = new ChainDiscoveryService(wasmProvider)
 * const results = await discovery.discoverChains(mnemonic, {
 *   onProgress: (progress) => {
 *     console.log(`${progress.chainsProcessed}/${progress.chainsTotal}`)
 *   }
 * })
 *
 * const chainsWithFunds = results.filter(r => r.hasBalance)
 * console.log('Chains with funds:', chainsWithFunds.map(r => r.chain))
 * ```
 */
export class ChainDiscoveryService {
  private readonly keyDeriver: MasterKeyDeriver

  constructor(private readonly wasmProvider: WasmProvider) {
    this.keyDeriver = new MasterKeyDeriver(wasmProvider)
  }

  /**
   * Discover chains with balances for a mnemonic
   *
   * @param mnemonic - BIP39 mnemonic phrase
   * @param options - Discovery options
   * @returns Array of discovery results for each chain
   */
  async discoverChains(
    mnemonic: string,
    options?: {
      config?: ChainDiscoveryConfig
      onProgress?: (progress: ChainDiscoveryProgress) => void
    }
  ): Promise<ChainDiscoveryResult[]> {
    const config = options?.config ?? {}
    const onProgress = options?.onProgress
    const concurrencyLimit = config.concurrencyLimit ?? 5
    const chains = config.chains ?? SUPPORTED_CHAINS
    const timeoutPerChain = config.timeoutPerChain ?? 10000

    const results: ChainDiscoveryResult[] = []
    const chainsWithBalance: Chain[] = []

    // Report initial progress
    onProgress?.({
      phase: 'validating',
      chainsProcessed: 0,
      chainsTotal: chains.length,
      chainsWithBalance: [],
      message: 'Validating mnemonic...',
    })

    // Process chains in batches
    for (let i = 0; i < chains.length; i += concurrencyLimit) {
      const batch = chains.slice(i, i + concurrencyLimit)

      // Report deriving phase
      onProgress?.({
        phase: 'deriving',
        chainsProcessed: i,
        chainsTotal: chains.length,
        chainsWithBalance: [...chainsWithBalance],
        message: `Deriving addresses (${i + 1}-${Math.min(i + batch.length, chains.length)} of ${chains.length})...`,
      })

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(chain => this.checkChainBalance(mnemonic, chain, timeoutPerChain))
      )

      // Collect results
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        const chain = batch[j]

        if (result.status === 'fulfilled') {
          results.push(result.value)
          if (result.value.hasBalance) {
            chainsWithBalance.push(chain)
          }
        } else {
          // On error, add a zero-balance result
          results.push({
            chain,
            address: '',
            balance: '0',
            decimals: 18,
            symbol: chain,
            hasBalance: false,
          })
        }

        // Report progress for each chain
        onProgress?.({
          phase: 'fetching',
          chain,
          chainsProcessed: i + j + 1,
          chainsTotal: chains.length,
          chainsWithBalance: [...chainsWithBalance],
          message: `Checking ${chain}...`,
        })
      }
    }

    // Report completion
    onProgress?.({
      phase: 'complete',
      chainsProcessed: chains.length,
      chainsTotal: chains.length,
      chainsWithBalance: [...chainsWithBalance],
      message: `Found ${chainsWithBalance.length} chain${chainsWithBalance.length === 1 ? '' : 's'} with balance`,
    })

    return results
  }

  /**
   * Check balance for a single chain
   */
  private async checkChainBalance(mnemonic: string, chain: Chain, timeout: number): Promise<ChainDiscoveryResult> {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout checking ${chain}`)), timeout)
    })

    // Race against timeout
    const resultPromise = this.doCheckChainBalance(mnemonic, chain)

    return Promise.race([resultPromise, timeoutPromise])
  }

  /**
   * Actually check the balance for a chain
   */
  private async doCheckChainBalance(mnemonic: string, chain: Chain): Promise<ChainDiscoveryResult> {
    try {
      // Derive address for this chain
      const address = await this.keyDeriver.deriveAddress(mnemonic, chain)

      // Fetch balance
      const balanceResult = await getCoinBalance({
        chain,
        address,
      })

      // Check if balance is non-zero
      const balance = balanceResult.amount?.toString() ?? '0'
      const hasBalance = BigInt(balance) > 0n

      return {
        chain,
        address,
        balance,
        decimals: balanceResult.decimals ?? 18,
        symbol: balanceResult.ticker ?? chain,
        hasBalance,
      }
    } catch (error) {
      // Return zero balance on error (don't fail the whole discovery)
      console.warn(`Failed to check balance for ${chain}:`, error)

      // Still try to get the address for display
      let address = ''
      try {
        address = await this.keyDeriver.deriveAddress(mnemonic, chain)
      } catch {
        // Ignore address derivation errors
      }

      return {
        chain,
        address,
        balance: '0',
        decimals: 18,
        symbol: chain,
        hasBalance: false,
      }
    }
  }

  /**
   * Get chains sorted by balance (highest first)
   */
  sortByBalance(results: ChainDiscoveryResult[]): ChainDiscoveryResult[] {
    return [...results].sort((a, b) => {
      // Chains with balance come first
      if (a.hasBalance && !b.hasBalance) return -1
      if (!a.hasBalance && b.hasBalance) return 1

      // Then sort by balance amount (descending)
      const balanceA = BigInt(a.balance || '0')
      const balanceB = BigInt(b.balance || '0')
      if (balanceB > balanceA) return 1
      if (balanceB < balanceA) return -1
      return 0
    })
  }

  /**
   * Check if a chain uses EdDSA signature algorithm
   */
  isEddsaChain(chain: Chain): boolean {
    return EDDSA_CHAINS.includes(chain)
  }
}
