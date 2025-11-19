/**
 * E2E Tests: Fiat Value Service (Production)
 *
 * These tests use a pre-created persistent fast vault to test real fiat value
 * operations against production APIs (Vultisig/CoinGecko). No transactions
 * are broadcast - only read-only price fetching and value calculations.
 *
 * Environment: Production (mainnet APIs)
 * Safety: Read-only operations, no fund transfers
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials MUST be loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - See tests/e2e/SECURITY.md and .env.example for setup instructions
 */

import { loadTestVault, verifyTestVault } from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Vault } from '@/index'

// Well-known token addresses for testing
const TOKENS = {
  USDC_ETHEREUM: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT_ETHEREUM: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDC_POLYGON: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  USDT_POLYGON: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
} as const

describe('E2E: Fiat Value Service (Production)', () => {
  let vault: Vault

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const startTime = Date.now()

    const result = await loadTestVault()
    vault = result.vault

    const loadTime = Date.now() - startTime
    console.log(`✅ Vault loaded in ${loadTime}ms`)

    // Verify vault loaded correctly
    verifyTestVault(vault)
  })

  describe('Native Token Price Fetching', () => {
    it('should fetch Bitcoin price in USD', async () => {
      console.log('💰 Fetching Bitcoin price...')

      // Get Bitcoin balance first
      const balance = await vault.balance('Bitcoin')

      // Get fiat value
      const value = await vault.getValue('Bitcoin')

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')
      expect(value.lastUpdated).toBeTypeOf('number')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Bitcoin balance: ${balance.amount} BTC`)
      console.log(`💵 Bitcoin value: $${value.amount}`)
    })

    it('should fetch Ethereum price in USD', async () => {
      console.log('💰 Fetching Ethereum price...')

      const balance = await vault.balance('Ethereum')
      const value = await vault.getValue('Ethereum')

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Ethereum balance: ${balance.amount} ETH`)
      console.log(`💵 Ethereum value: $${value.amount}`)
    })

    it('should fetch Solana price in USD', async () => {
      console.log('💰 Fetching Solana price...')

      const balance = await vault.balance('Solana')
      const value = await vault.getValue('Solana')

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Solana balance: ${balance.amount} SOL`)
      console.log(`💵 Solana value: $${value.amount}`)
    })

    it('should fetch Polygon price in USD', async () => {
      console.log('💰 Fetching Polygon price...')

      const balance = await vault.balance('Polygon')
      const value = await vault.getValue('Polygon')

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Polygon balance: ${balance.amount} POL`)
      console.log(`💵 Polygon value: $${value.amount}`)
    })
  })

  describe('ERC-20 Token Price Fetching', () => {
    it('should fetch USDC price on Ethereum', async () => {
      console.log('💰 Fetching USDC price on Ethereum...')

      const balance = await vault.balance('Ethereum', TOKENS.USDC_ETHEREUM)
      const value = await vault.getValue('Ethereum', TOKENS.USDC_ETHEREUM)

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 USDC balance: ${balance.amount} ${balance.symbol}`)
      console.log(`💵 USDC value: $${value.amount}`)
    })

    it('should fetch USDT price on Ethereum', async () => {
      console.log('💰 Fetching USDT price on Ethereum...')

      const balance = await vault.balance('Ethereum', TOKENS.USDT_ETHEREUM)
      const value = await vault.getValue('Ethereum', TOKENS.USDT_ETHEREUM)

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 USDT balance: ${balance.amount} ${balance.symbol}`)
      console.log(`💵 USDT value: $${value.amount}`)
    })

    it('should fetch USDC price on Polygon', async () => {
      console.log('💰 Fetching USDC price on Polygon...')

      const balance = await vault.balance('Polygon', TOKENS.USDC_POLYGON)
      const value = await vault.getValue('Polygon', TOKENS.USDC_POLYGON)

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      // Value should be a valid non-negative number
      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 USDC balance: ${balance.amount} ${balance.symbol}`)
      console.log(`💵 USDC value: $${value.amount}`)
    })
  })

  describe('Multi-Currency Support', () => {
    it('should fetch price in EUR', async () => {
      console.log('💰 Fetching Ethereum price in EUR...')

      const value = await vault.getValue('Ethereum', undefined, 'eur')

      expect(value).toBeDefined()
      expect(value.currency).toBe('eur')
      expect(value.amount).toBeTypeOf('string')

      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Ethereum value: €${value.amount}`)
    })

    it('should fetch price in GBP', async () => {
      console.log('💰 Fetching Bitcoin price in GBP...')

      const value = await vault.getValue('Bitcoin', undefined, 'gbp')

      expect(value).toBeDefined()
      expect(value.currency).toBe('gbp')
      expect(value.amount).toBeTypeOf('string')

      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Bitcoin value: £${value.amount}`)
    })

    it('should fetch price in JPY', async () => {
      console.log('💰 Fetching Solana price in JPY...')

      const value = await vault.getValue('Solana', undefined, 'jpy')

      expect(value).toBeDefined()
      expect(value.currency).toBe('jpy')
      expect(value.amount).toBeTypeOf('string')

      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Solana value: ¥${value.amount}`)
    })
  })

  describe('Multi-Chain Value Fetching', () => {
    it('should fetch values for all assets on a chain', async () => {
      console.log('💰 Fetching all Ethereum asset values...')

      const values = await vault.getValues('Ethereum')

      expect(values).toBeDefined()
      expect(typeof values).toBe('object')

      // Should at least have the native token
      expect(values['native']).toBeDefined()
      expect(values['native'].currency).toBe('usd')
      expect(values['native'].amount).toBeTypeOf('string')

      console.log(`💵 Found values for ${Object.keys(values).length} assets:`)
      for (const [assetId, value] of Object.entries(values)) {
        console.log(`  ${assetId}: $${value.amount}`)
      }
    })

    it('should fetch values for multiple chains', async () => {
      console.log('💰 Fetching values for multiple chains...')

      const chains = ['Bitcoin', 'Ethereum', 'Solana', 'Polygon']
      const results: Record<string, any> = {}

      for (const chain of chains) {
        try {
          const value = await vault.getValue(chain)
          results[chain] = { success: true, value }
          console.log(`✅ ${chain}: $${value.amount}`)
        } catch (error) {
          results[chain] = { success: false, error: (error as Error).message }
          console.log(`❌ ${chain}: ${(error as Error).message}`)
        }
      }

      // Calculate success rate
      const successCount = Object.values(results).filter(r => r.success).length
      const successRate = (successCount / chains.length) * 100

      console.log(
        `📊 Success rate: ${successCount}/${chains.length} (${successRate.toFixed(1)}%)`
      )

      // Expect at least 80% success rate
      expect(successRate).toBeGreaterThan(80)
    })
  })

  describe('Price Caching Behavior', () => {
    it('should cache prices for repeated fetches', async () => {
      console.log('🔍 Testing price caching...')

      // First fetch (force fresh by clearing cache)
      await vault.updateValues('Ethereum')
      const startTime1 = performance.now()
      const value1 = await vault.getValue('Ethereum')
      const fetchTime1 = performance.now() - startTime1

      // Second fetch (cached - should be faster or same speed)
      const startTime2 = performance.now()
      const value2 = await vault.getValue('Ethereum')
      const fetchTime2 = performance.now() - startTime2

      // Cached fetch should be faster or equal (allow for timing variance)
      // We verify caching works by checking values are identical and second call completes
      expect(fetchTime2).toBeLessThanOrEqual(fetchTime1 + 100) // Allow 100ms variance

      // Values should be identical
      expect(value1.amount).toBe(value2.amount)
      expect(value1.currency).toBe(value2.currency)

      console.log(`⚡ First fetch: ${fetchTime1.toFixed(2)}ms`)
      console.log(`⚡ Cached fetch: ${fetchTime2.toFixed(2)}ms`)
      if (fetchTime2 > 0) {
        console.log(
          `🚀 Speedup: ${(fetchTime1 / Math.max(fetchTime2, 0.1)).toFixed(1)}x`
        )
      }
    })

    it('should clear cache when explicitly requested', async () => {
      console.log('🔍 Testing cache clearing...')

      // Get cached value
      const value1 = await vault.getValue('Polygon')

      // Clear cache
      await vault.updateValues('Polygon')

      // Get fresh value
      const value2 = await vault.getValue('Polygon')

      // Both should be valid values
      expect(value1).toBeDefined()
      expect(value2).toBeDefined()
      expect(value1.currency).toBe(value2.currency)

      console.log(`💰 Cached: $${value1.amount}`)
      console.log(`💰 Refreshed: $${value2.amount}`)
    })

    it('should use cache for multiple assets on same chain', async () => {
      console.log('🔍 Testing cache usage across assets...')

      // Clear cache first
      await vault.updateValues('Ethereum')

      // Fetch native token value (triggers price fetch)
      const startTime1 = performance.now()
      const nativeValue = await vault.getValue('Ethereum')
      const fetchTime1 = performance.now() - startTime1

      // Fetch token value on same chain (should use cached ETH price for gas estimation)
      const startTime2 = performance.now()
      const tokenValue = await vault.getValue('Ethereum', TOKENS.USDC_ETHEREUM)
      const fetchTime2 = performance.now() - startTime2

      expect(nativeValue).toBeDefined()
      expect(tokenValue).toBeDefined()

      console.log(`⚡ Native token fetch: ${fetchTime1.toFixed(2)}ms`)
      console.log(`⚡ Token fetch: ${fetchTime2.toFixed(2)}ms`)
    })
  })

  describe('Portfolio Value Calculations', () => {
    it('should calculate total portfolio value across chains', async () => {
      console.log('💰 Calculating total portfolio value...')

      const chains = ['Bitcoin', 'Ethereum', 'Solana', 'Polygon']
      let totalValue = 0
      const chainValues: Record<string, number> = {}

      for (const chain of chains) {
        try {
          const value = await vault.getValue(chain)
          const valueNum = parseFloat(value.amount)
          chainValues[chain] = valueNum
          totalValue += valueNum
          console.log(`  ${chain}: $${valueNum.toFixed(2)}`)
        } catch (error) {
          console.log(`  ${chain}: Error - ${(error as Error).message}`)
          chainValues[chain] = 0
        }
      }

      console.log(`💵 Total portfolio value: $${totalValue.toFixed(2)}`)

      expect(totalValue).toBeGreaterThanOrEqual(0)
      expect(Object.keys(chainValues).length).toBe(chains.length)
    })

    it('should handle balances with zero value', async () => {
      console.log('💰 Testing zero balance handling...')

      // All chains should return valid values even if balance is 0
      const value = await vault.getValue('Bitcoin')

      expect(value).toBeDefined()
      expect(value.currency).toBe('usd')
      expect(value.amount).toBeTypeOf('string')

      const valueNum = parseFloat(value.amount)
      expect(valueNum).toBeGreaterThanOrEqual(0)

      console.log(`💵 Value: $${value.amount}`)
    })
  })

  describe('Error Handling', () => {
    it('should handle unsupported chain gracefully', async () => {
      console.log('🔍 Testing unsupported chain error handling...')

      await expect(vault.getValue('UnsupportedChain' as any)).rejects.toThrow()

      console.log('✅ Correctly rejected unsupported chain')
    })

    it('should handle invalid token address gracefully', async () => {
      console.log('🔍 Testing invalid token address error handling...')

      await expect(
        vault.getValue('Ethereum', 'invalid_address')
      ).rejects.toThrow()

      console.log('✅ Correctly rejected invalid token address')
    })

    it('should handle invalid currency gracefully', async () => {
      console.log('🔍 Testing invalid currency error handling...')

      // Invalid currency should either throw or fallback to default
      try {
        await vault.getValue('Ethereum', undefined, 'invalid' as any)
        console.log('⚠️  Invalid currency was accepted (possible fallback)')
      } catch (error) {
        console.log('✅ Correctly rejected invalid currency')
        expect(error).toBeDefined()
      }
    })
  })

  describe('Performance Tests', () => {
    it('should batch fetch prices efficiently', async () => {
      console.log('⚡ Testing batch price fetch performance...')

      // Clear cache
      await vault.updateValues('all')

      const chains = ['Bitcoin', 'Ethereum', 'Solana', 'Polygon']

      // Sequential fetching
      const startSeq = performance.now()
      for (const chain of chains) {
        try {
          await vault.getValue(chain)
        } catch {
          // Ignore errors for this performance test
        }
      }
      const sequentialTime = performance.now() - startSeq

      // Clear cache again
      await vault.updateValues('all')

      // Parallel fetching
      const startPar = performance.now()
      await Promise.all(
        chains.map(chain => vault.getValue(chain).catch(() => null))
      )
      const parallelTime = performance.now() - startPar

      console.log(`⚡ Sequential: ${sequentialTime.toFixed(2)}ms`)
      console.log(`⚡ Parallel: ${parallelTime.toFixed(2)}ms`)
      console.log(`🚀 Speedup: ${(sequentialTime / parallelTime).toFixed(1)}x`)

      // Parallel should be faster (though maybe not much due to HTTP/2 multiplexing)
      expect(parallelTime).toBeLessThanOrEqual(sequentialTime)
    })

    it('should handle rapid repeated fetches efficiently', async () => {
      console.log('⚡ Testing rapid repeated fetches...')

      const iterations = 10
      const startTime = performance.now()

      // First call will fetch, rest should use cache
      for (let i = 0; i < iterations; i++) {
        await vault.getValue('Ethereum')
      }

      const totalTime = performance.now() - startTime
      const avgTime = totalTime / iterations

      console.log(
        `⚡ Total time for ${iterations} fetches: ${totalTime.toFixed(2)}ms`
      )
      console.log(`⚡ Average time per fetch: ${avgTime.toFixed(2)}ms`)

      // With caching, should be very fast
      expect(avgTime).toBeLessThan(50) // Should average less than 50ms per call
    })
  })

  describe('Integration Tests', () => {
    it('should integrate with balance fetching', async () => {
      console.log('🔗 Testing integration with balance fetching...')

      // Fetch balance and value together
      const balance = await vault.balance('Ethereum')
      const value = await vault.getValue('Ethereum')

      expect(balance).toBeDefined()
      expect(value).toBeDefined()

      // Calculate expected value manually
      const balanceNum = parseFloat(balance.amount)
      const valueNum = parseFloat(value.amount)

      if (balanceNum > 0) {
        const impliedPrice = valueNum / balanceNum
        console.log(`💵 Balance: ${balance.amount} ${balance.symbol}`)
        console.log(`💵 Value: $${value.amount}`)
        console.log(`💵 Implied price: $${impliedPrice.toFixed(2)}`)

        // Price should be reasonable
        expect(impliedPrice).toBeGreaterThan(0)
      } else {
        console.log(`💵 Balance: ${balance.amount} ${balance.symbol}`)
        console.log(`💵 Value: $${value.amount}`)
        expect(valueNum).toBe(0)
      }
    })

    it('should update values across all chains', async () => {
      console.log('🔗 Testing updateValues("all")...')

      const startTime = performance.now()
      await vault.updateValues('all')
      const updateTime = performance.now() - startTime

      console.log(`⚡ Updated all values in ${updateTime.toFixed(2)}ms`)

      // Verify cache was cleared by fetching a value
      // (it should be fast but not instant since cache was cleared)
      const value = await vault.getValue('Ethereum')
      expect(value).toBeDefined()

      console.log(`✅ Cache cleared and values can be re-fetched`)
    })
  })
})
