/**
 * ChainDiscoveryService - Scans chains for existing balances
 *
 * Derives addresses from a mnemonic and checks for non-zero balances
 * to help users identify which chains they have funds on.
 */
import { Chain } from '@core/chain/Chain'
import { getCoinBalance } from '@core/chain/coin/balance'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'

import { SUPPORTED_CHAINS } from '../constants'
import type { WasmProvider } from '../context/SdkContext'
import { MasterKeyDeriver } from './MasterKeyDeriver'
import type { ChainDiscoveryAggregate, ChainDiscoveryProgress, ChainDiscoveryResult } from './types'

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
   * Also checks Solana's Phantom wallet derivation path and determines
   * if it should be used (when Phantom path has balance but standard doesn't).
   *
   * @param mnemonic - BIP39 mnemonic phrase
   * @param options - Discovery options
   * @returns Aggregate result with chain discoveries and Phantom Solana path flag
   */
  async discoverChains(
    mnemonic: string,
    options?: {
      config?: ChainDiscoveryConfig
      onProgress?: (progress: ChainDiscoveryProgress) => void
    }
  ): Promise<ChainDiscoveryAggregate> {
    const config = options?.config ?? {}
    const onProgress = options?.onProgress
    // Ensure concurrencyLimit is at least 1 to prevent infinite loop
    const concurrencyLimit = Math.max(1, config.concurrencyLimit ?? 5)
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

    // Check Phantom Solana path if Solana was in the scan
    let usePhantomSolanaPath = false
    const solanaResult = results.find(r => r.chain === Chain.Solana)

    if (solanaResult) {
      try {
        const phantomCheck = await this.checkPhantomSolanaBalance(mnemonic, timeoutPerChain)
        const standardBalance = BigInt(solanaResult.balance || '0')

        // Use Phantom path if it has balance AND standard path has no balance
        // This matches vultisig-windows upstream logic
        usePhantomSolanaPath = phantomCheck.balance > 0n && standardBalance === 0n

        // If Phantom has balance but standard doesn't, update the Solana result
        if (usePhantomSolanaPath) {
          solanaResult.address = phantomCheck.address
          solanaResult.balance = phantomCheck.balance.toString()
          solanaResult.hasBalance = true
          if (!chainsWithBalance.includes(Chain.Solana)) {
            chainsWithBalance.push(Chain.Solana)
          }
        }
      } catch (error) {
        // Phantom check failed, continue with standard path
        console.warn('Failed to check Phantom Solana path:', error)
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

    return {
      results,
      usePhantomSolanaPath,
    }
  }

  /**
   * Check balance for a single chain
   */
  private async checkChainBalance(mnemonic: string, chain: Chain, timeout: number): Promise<ChainDiscoveryResult> {
    // Create timeout promise with cleanup to prevent unhandled rejections
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Timeout checking ${chain}`)), timeout)
    })

    // Race against timeout, ensuring timer is cleaned up
    const resultPromise = this.doCheckChainBalance(mnemonic, chain)

    return Promise.race([resultPromise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
  }

  /**
   * Actually check the balance for a chain
   */
  private async doCheckChainBalance(mnemonic: string, chain: Chain): Promise<ChainDiscoveryResult> {
    // Get chain's native coin metadata
    const coinMeta = chainFeeCoin[chain]
    const decimals = coinMeta?.decimals ?? 18
    const symbol = coinMeta?.ticker ?? chain

    try {
      // Derive address for this chain
      const address = await this.keyDeriver.deriveAddress(mnemonic, chain)

      // Fetch balance (returns bigint)
      const balanceRaw = await getCoinBalance({
        chain,
        address,
      })

      // Check if balance is non-zero
      const balance = balanceRaw.toString()
      const hasBalance = balanceRaw > 0n

      return {
        chain,
        address,
        balance,
        decimals,
        symbol,
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
        decimals,
        symbol,
        hasBalance: false,
      }
    }
  }

  /**
   * Check Solana balance using Phantom wallet's derivation path
   *
   * Phantom uses m/44'/501'/0'/0' instead of the standard Solana BIP44 path.
   * This helps detect wallets that were originally created in Phantom.
   */
  private async checkPhantomSolanaBalance(
    mnemonic: string,
    timeout: number
  ): Promise<{ address: string; balance: bigint }> {
    // Create timeout promise with cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout checking Phantom Solana path')), timeout)
    })

    const checkPromise = async () => {
      const address = await this.keyDeriver.deriveSolanaAddressWithPhantomPath(mnemonic)
      const balance = await getCoinBalance({
        chain: Chain.Solana,
        address,
      })
      return { address, balance }
    }

    return Promise.race([checkPromise(), timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
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
