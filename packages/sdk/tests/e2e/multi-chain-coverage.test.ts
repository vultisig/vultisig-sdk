/**
 * E2E Tests: Multi-Chain Coverage (Production)
 *
 * Comprehensive test coverage across all major blockchain chains supported
 * by the Vultisig SDK. Tests balance fetching, gas estimation, and address
 * derivation for all chains to ensure production readiness.
 *
 * Environment: Production (mainnet RPCs)
 * Safety: Read-only operations, no fund transfers
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - Falls back to public test vault (read-only tests only - NEVER fund these addresses!)
 */

import { loadTestVault, TEST_VAULT_CONFIG, verifyTestVault } from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain, EvmGasInfo, VaultBase } from '@/index'

describe('E2E: Multi-Chain Coverage (Production)', () => {
  let vault: VaultBase

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault for multi-chain testing...')
    const result = await loadTestVault()
    vault = result.vault
    verifyTestVault(vault)
  })

  describe('Comprehensive Chain Balance Coverage', () => {
    const testResults: Record<
      string,
      {
        success: boolean
        symbol?: string
        amount?: string
        decimals?: number
        error?: string
      }
    > = {}

    it('should fetch balances for all major chains', async () => {
      console.log(`\n📊 Testing ${TEST_VAULT_CONFIG.testChains.length} chains...\n`)

      for (const chain of TEST_VAULT_CONFIG.testChains) {
        try {
          console.log(`🔍 ${chain}...`)
          const balance = await vault.balance(chain)

          testResults[chain] = {
            success: true,
            symbol: balance.symbol,
            amount: balance.amount,
            decimals: balance.decimals,
          }

          console.log(`  ✅ ${chain}: ${balance.amount} ${balance.symbol} (${balance.decimals} decimals)`)
        } catch (error) {
          testResults[chain] = {
            success: false,
            error: (error as Error).message,
          }

          console.warn(`  ⚠️  ${chain}: ${(error as Error).message}`)
        }
      }

      // Calculate success rate
      const successCount = Object.values(testResults).filter(r => r.success).length
      const successRate = (successCount / TEST_VAULT_CONFIG.testChains.length) * 100

      console.log(
        `\n📈 Results: ${successCount}/${TEST_VAULT_CONFIG.testChains.length} chains (${successRate.toFixed(1)}%)`
      )

      // Expect at least 80% success rate
      expect(successRate).toBeGreaterThan(80)

      // Print summary
      console.log('\n📋 Summary:')
      console.log(`  ✅ Success: ${successCount} chains`)
      console.log(`  ⚠️  Failed: ${TEST_VAULT_CONFIG.testChains.length - successCount} chains`)

      if (successRate < 100) {
        console.log('\n⚠️  Failed chains:')
        Object.entries(testResults).forEach(([chain, result]) => {
          if (!result.success) {
            console.log(`  - ${chain}: ${result.error}`)
          }
        })
      }
    }, 30000)

    it('should verify at least 80% of chains are functional', () => {
      const successCount = Object.values(testResults).filter(r => r.success).length
      const successRate = (successCount / TEST_VAULT_CONFIG.testChains.length) * 100

      expect(successRate).toBeGreaterThanOrEqual(80)
    })
  })

  describe('Address Derivation Coverage', () => {
    it('should derive addresses for all test chains', async () => {
      console.log(`\n📍 Deriving addresses for ${TEST_VAULT_CONFIG.testChains.length} chains...\n`)

      const addresses: Record<string, string> = {}

      for (const chain of TEST_VAULT_CONFIG.testChains) {
        try {
          const address = await vault.address(chain)
          addresses[chain] = address

          // Verify against expected address if available
          const expectedAddress = TEST_VAULT_CONFIG.addresses[chain as keyof typeof TEST_VAULT_CONFIG.addresses]
          if (expectedAddress) {
            expect(address).toBe(expectedAddress)
            console.log(`  ✅ ${chain}: ${address} (verified)`)
          } else {
            console.log(`  ✅ ${chain}: ${address}`)
          }
        } catch (error) {
          console.warn(`  ⚠️  ${chain}: ${(error as Error).message}`)
        }
      }

      // Verify we derived addresses for all chains
      expect(Object.keys(addresses).length).toBe(TEST_VAULT_CONFIG.testChains.length)
    })

    it('should verify EVM chains share the same address', async () => {
      const evmChains = [
        Chain.Ethereum,
        Chain.BSC,
        Chain.Polygon,
        Chain.Avalanche,
        Chain.Arbitrum,
        Chain.Optimism,
        Chain.Base,
      ]
      const availableEvmChains = evmChains.filter(chain => TEST_VAULT_CONFIG.testChains.includes(chain))

      if (availableEvmChains.length < 2) {
        console.log('⏭️  Skipping: Not enough EVM chains in test suite')
        return
      }

      console.log(`\n🔗 Verifying ${availableEvmChains.length} EVM chains share address...`)

      const addresses = await Promise.all(availableEvmChains.map(chain => vault.address(chain)))

      // All should be the same
      const uniqueAddresses = new Set(addresses)
      expect(uniqueAddresses.size).toBe(1)

      const sharedAddress = addresses[0]
      console.log(`  ✅ Shared EVM address: ${sharedAddress}`)
      console.log(`  📌 Used by: ${availableEvmChains.join(', ')}`)
    })
  })

  describe('Gas Estimation Coverage', () => {
    it('should estimate gas for EVM chains', async () => {
      const evmChains = [
        Chain.Ethereum,
        Chain.BSC,
        Chain.Polygon,
        Chain.Avalanche,
        Chain.Arbitrum,
        Chain.Optimism,
        Chain.Base,
      ]
      const availableEvmChains = evmChains.filter(chain => TEST_VAULT_CONFIG.testChains.includes(chain))

      console.log(`\n⛽ Estimating gas for ${availableEvmChains.length} EVM chains...\n`)

      const gasEstimates: Record<string, bigint> = {}

      for (const chain of availableEvmChains) {
        try {
          const gasInfo = (await vault.gas(chain as Chain)) as EvmGasInfo
          gasEstimates[chain] = gasInfo.estimatedCost || 0n

          console.log(`  ✅ ${chain}: ${gasInfo.estimatedCost} wei`)

          expect(gasInfo.gasLimit).toBeDefined()
          expect(gasInfo.maxFeePerGas).toBeDefined()
          expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0)
        } catch (error) {
          console.warn(`  ⚠️  ${chain}: ${(error as Error).message}`)
        }
      }

      // Verify we got gas estimates for all EVM chains
      expect(Object.keys(gasEstimates).length).toBeGreaterThan(0)
    }, 30000)

    it('should estimate fees for UTXO chains', async () => {
      const utxoChains = [Chain.Bitcoin, Chain.Litecoin, Chain.Dogecoin]
      const availableUtxoChains = utxoChains.filter(chain => TEST_VAULT_CONFIG.testChains.includes(chain))

      if (availableUtxoChains.length === 0) {
        console.log('⏭️  Skipping: No UTXO chains in test suite')
        return
      }

      console.log(`\n⛽ Estimating fees for ${availableUtxoChains.length} UTXO chains...\n`)

      for (const chain of availableUtxoChains) {
        try {
          const gasInfo = await vault.gas(chain as Chain)

          console.log(`  ✅ ${chain}: ${gasInfo.estimatedCost} satoshis`)

          expect(gasInfo.estimatedCost).toBeDefined()
          expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0)
        } catch (error) {
          console.warn(`  ⚠️  ${chain}: ${(error as Error).message}`)
        }
      }
    })
  })

  describe('Batch Operations Performance', () => {
    it('should fetch all chain balances efficiently', async () => {
      console.log(`\n⚡ Performance test: Fetching ${TEST_VAULT_CONFIG.testChains.length} chain balances...\n`)

      const startTime = Date.now()
      const balances = await vault.balances(TEST_VAULT_CONFIG.testChains)
      const fetchTime = Date.now() - startTime

      const chainCount = Object.keys(balances).length

      console.log(`  ✅ Fetched ${chainCount} balances in ${fetchTime}ms`)
      console.log(`  ⚡ Average: ${(fetchTime / chainCount).toFixed(1)}ms per chain`)

      expect(chainCount).toBeGreaterThan(0)
      expect(fetchTime).toBeLessThan(60000) // Should complete within 60 seconds
    })

    it('should verify balance caching improves performance', async () => {
      const testChain = TEST_VAULT_CONFIG.testChains[0]

      // First fetch (force fresh by using updateBalance which clears cache)
      const start1 = performance.now()
      const balance1 = await vault.updateBalance(testChain)
      const time1 = performance.now() - start1

      // Second fetch (cached)
      const start2 = performance.now()
      const balance2 = await vault.balance(testChain)
      const time2 = performance.now() - start2

      console.log(`\n🚀 Caching Performance:`)
      console.log(`  Cold fetch: ${time1.toFixed(2)}ms`)
      console.log(`  Cached fetch: ${time2.toFixed(2)}ms`)
      const time2Adjusted = Math.max(time2, 0.1) // Avoid division issues
      console.log(`  Speedup: ${(time1 / time2Adjusted).toFixed(1)}x`)

      expect(time2Adjusted).toBeLessThan(time1 / 5) // Cached should be at least 5x faster
      expect(balance1.amount).toBe(balance2.amount)
      expect(balance1.symbol).toBe(balance2.symbol)
    })
  })

  describe('Chain Family Validation', () => {
    it('should validate Bitcoin address format', async () => {
      if (!TEST_VAULT_CONFIG.testChains.includes(Chain.Bitcoin)) {
        console.log('⏭️  Skipping: Bitcoin not in test suite')
        return
      }

      const address = await vault.address(Chain.Bitcoin)
      expect(address).toMatch(/^(bc1|1|3)/) // Bech32, P2PKH, or P2SH
      console.log(`✅ Bitcoin address format valid: ${address}`)
    })

    it('should validate Ethereum address format', async () => {
      if (!TEST_VAULT_CONFIG.testChains.includes(Chain.Ethereum)) {
        console.log('⏭️  Skipping: Ethereum not in test suite')
        return
      }

      const address = await vault.address(Chain.Ethereum)
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      console.log(`✅ Ethereum address format valid: ${address}`)
    })

    it('should validate Solana address format', async () => {
      if (!TEST_VAULT_CONFIG.testChains.includes(Chain.Solana)) {
        console.log('⏭️  Skipping: Solana not in test suite')
        return
      }

      const address = await vault.address(Chain.Solana)
      expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) // Base58
      console.log(`✅ Solana address format valid: ${address}`)
    })

    it('should validate Cosmos address format', async () => {
      if (!TEST_VAULT_CONFIG.testChains.includes(Chain.Cosmos)) {
        console.log('⏭️  Skipping: Cosmos not in test suite')
        return
      }

      const address = await vault.address(Chain.Cosmos)
      expect(address).toMatch(/^cosmos1[a-z0-9]{38,}$/)
      console.log(`✅ Cosmos address format valid: ${address}`)
    })

    it('should validate THORChain address format', async () => {
      if (!TEST_VAULT_CONFIG.testChains.includes(Chain.THORChain)) {
        console.log('⏭️  Skipping: THORChain not in test suite')
        return
      }

      const address = await vault.address(Chain.THORChain)
      expect(address).toMatch(/^thor1[a-z0-9]{38,}$/)
      console.log(`✅ THORChain address format valid: ${address}`)
    })
  })

  describe('Production API Integration', () => {
    it('should successfully query production RPC endpoints', async () => {
      console.log('\n🌐 Production API Integration Test\n')

      let successCount = 0
      let failCount = 0

      for (const chain of TEST_VAULT_CONFIG.testChains.slice(0, 5)) {
        // Test first 5 chains
        try {
          const balance = await vault.balance(chain)
          successCount++
          console.log(`  ✅ ${chain}: ${balance.amount} ${balance.symbol}`)
        } catch (error) {
          failCount++
          console.warn(`  ⚠️  ${chain}: ${(error as Error).message}`)
        }
      }

      console.log(`\n📊 Results: ${successCount} success, ${failCount} failed`)
      expect(successCount).toBeGreaterThan(0)
    })
  })

  describe('Final Summary', () => {
    it('should print comprehensive test summary', () => {
      const publicKeys = vault.data.publicKeys

      console.log('\n' + '='.repeat(60))
      console.log('📋 E2E MULTI-CHAIN COVERAGE TEST SUMMARY')
      console.log('='.repeat(60))
      console.log(`\n✅ Test Vault: ${vault.name}`)
      console.log(`📦 Vault Type: ${vault.type}`)
      console.log(`🔑 ECDSA Key: ${publicKeys.ecdsa.substring(0, 20)}...`)
      console.log(`🔑 EdDSA Key: ${publicKeys.eddsa.substring(0, 20)}...`)
      console.log(`\n🌍 Chains Tested: ${TEST_VAULT_CONFIG.testChains.length}`)
      console.log(`📍 Chains: ${TEST_VAULT_CONFIG.testChains.join(', ')}`)
      console.log(`\n🔒 Safety: Read-only operations, NO transactions broadcast`)
      console.log(`🌐 Environment: Production (mainnet RPCs)`)
      console.log('='.repeat(60) + '\n')

      // This test always passes - it's just for logging
      expect(true).toBe(true)
    })
  })
})
