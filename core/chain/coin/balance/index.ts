import { ChainKind, getChainKind } from '@core/chain/ChainKind'

import { CoinBalanceResolver } from './resolver'
import { getCardanoCoinBalance } from './resolvers/cardano'
import { getCosmosCoinBalance } from './resolvers/cosmos'
import { getEvmCoinBalance } from './resolvers/evm'
import { getPolkadotCoinBalance } from './resolvers/polkadot'
import { getRippleCoinBalance } from './resolvers/ripple'
import { getSolanaCoinBalance } from './resolvers/solana'
import { getSuiCoinBalance } from './resolvers/sui'
import { getTonCoinBalance } from './resolvers/ton'
import { getTronCoinBalance } from './resolvers/tron'
import { getUtxoCoinBalance } from './resolvers/utxo'
import { classifyBalanceError, BalanceLookupError } from './errors'

// Balance lookup monitoring and error tracking
interface BalanceLookupResult {
  chain: string
  address: string
  success: boolean
  attempts: number
  duration: number
  error?: string
  fallbackUsed: boolean
}

class BalanceLookupMonitor {
  private results: BalanceLookupResult[] = []
  private maxResults = 100 // Keep last 100 results for monitoring

  recordResult(result: BalanceLookupResult) {
    this.results.push(result)
    if (this.results.length > this.maxResults) {
      this.results.shift() // Remove oldest
    }
  }

  getStats() {
    const total = this.results.length
    const successful = this.results.filter(r => r.success).length
    const failed = total - successful
    const fallbackUsed = this.results.filter(r => r.fallbackUsed).length
    const avgDuration =
      this.results.reduce((sum, r) => sum + r.duration, 0) / total

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      fallbackRate: total > 0 ? (fallbackUsed / total) * 100 : 0,
      averageDuration: avgDuration || 0,
    }
  }

  getRecentFailures() {
    return this.results.filter(r => !r.success).slice(-10) // Last 10 failures
  }
}

const balanceMonitor = new BalanceLookupMonitor()

const resolvers: Record<ChainKind, CoinBalanceResolver<any>> = {
  utxo: getUtxoCoinBalance,
  cosmos: getCosmosCoinBalance,
  sui: getSuiCoinBalance,
  evm: getEvmCoinBalance,
  ton: getTonCoinBalance,
  ripple: getRippleCoinBalance,
  polkadot: getPolkadotCoinBalance,
  solana: getSolanaCoinBalance,
  tron: getTronCoinBalance,
  cardano: getCardanoCoinBalance,
}

/**
 * Enhanced balance resolver with timeout, retry, and fallback mechanisms
 */
const getCoinBalanceWithFallback: CoinBalanceResolver = async input => {
  const chainKind = getChainKind(input.chain)
  const resolver = resolvers[chainKind]
  const startTime = Date.now()

  // Configuration for retry and timeout logic
  const maxRetries = 2
  const timeoutMs = 8000 // 8 second timeout per attempt
  const retryDelayMs = 1000 // 1 second delay between retries

  const attemptBalanceLookup = async (attempt: number): Promise<bigint> => {
    const balancePromise = resolver(input)

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Balance lookup timeout after ${timeoutMs}ms (attempt ${attempt})`
            )
          ),
        timeoutMs
      )
    })

    return Promise.race([balancePromise, timeoutPromise])
  }

  let lastBalanceError: BalanceLookupError | undefined
  let attemptsMade = 0

  // Try balance lookup with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    attemptsMade = attempt
    const attemptStartTime = Date.now()

    try {
      const result = await attemptBalanceLookup(attempt)
      const duration = Date.now() - startTime

      // Record successful lookup
      balanceMonitor.recordResult({
        chain: input.chain,
        address: input.address,
        success: true,
        attempts: attempt,
        duration,
        fallbackUsed: false,
      })

      console.log(
        `✅ Balance lookup successful for ${input.chain}:${input.address} in ${Date.now() - attemptStartTime}ms (attempt ${attempt})`
      )
      return result
    } catch (error) {
      const attemptDuration = Date.now() - attemptStartTime
      const balanceError = classifyBalanceError(
        input.chain,
        input.address,
        error,
        attempt
      )
      lastBalanceError = balanceError

      // Log with appropriate level based on error type
      const logLevel = balanceError.type === 'TIMEOUT' ? 'warn' : 'error'
      console[logLevel](
        `❌ Balance lookup attempt ${attempt}/${maxRetries} failed for ${input.chain}:${input.address} (${attemptDuration}ms):`,
        {
          type: balanceError.type,
          message: balanceError.message,
          attempt,
          duration: attemptDuration,
        }
      )

      // For rate limiting, wait longer before retry
      if (balanceError.type === 'API_RATE_LIMIT') {
        const rateLimitDelay = 2000 // 2 seconds for rate limiting
        console.warn(
          `⏳ Rate limited, waiting ${rateLimitDelay}ms before retry...`
        )
        await new Promise(resolve => setTimeout(resolve, rateLimitDelay))
      }
      // For other errors, use normal retry delay
      else if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  // All attempts failed - return zero balance as fallback
  const totalDuration = Date.now() - startTime

  balanceMonitor.recordResult({
    chain: input.chain,
    address: input.address,
    success: false,
    attempts: attemptsMade,
    duration: totalDuration,
    error: lastBalanceError?.message,
    fallbackUsed: true,
  })

  console.error(
    `💥 All balance lookup attempts failed for ${input.chain}:${input.address}`,
    {
      totalDuration: `${totalDuration}ms`,
      attempts: attemptsMade,
      errorType: lastBalanceError?.type,
      finalError: lastBalanceError?.message,
      fallbackUsed: true,
    }
  )

  return BigInt(0)
}

export const getCoinBalance: CoinBalanceResolver = getCoinBalanceWithFallback

// Export monitoring functions for debugging and observability
export const getBalanceLookupStats = () => balanceMonitor.getStats()
export const getRecentBalanceFailures = () => balanceMonitor.getRecentFailures()
export const resetBalanceStats = () => {
  // Reset the monitor by creating a new instance
  const newMonitor = new BalanceLookupMonitor()
  Object.assign(balanceMonitor, newMonitor)
}
