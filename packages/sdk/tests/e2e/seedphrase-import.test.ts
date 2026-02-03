/**
 * E2E Tests: Seedphrase Import
 *
 * Tests the full seedphrase import flow via the public Vultisig API.
 * Uses real WASM for cryptographic operations and real network calls
 * for balance checking during chain discovery.
 *
 * Environment: Production (mainnet RPCs)
 * Safety: Read-only operations for validation and discovery
 *
 * SECURITY: See SECURITY.md for setup instructions.
 * - Test seedphrase MUST be loaded from environment variable (TEST_SEEDPHRASE)
 * - Never use a seedphrase that controls real funds
 */

import { beforeAll, describe, expect, it } from 'vitest'

import type { ChainDiscoveryProgress } from '../../src/seedphrase/types'
import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { Chain } from '../../src/types'
import { Vultisig } from '../../src/Vultisig'

// Load seedphrase from environment
const TEST_SEEDPHRASE = process.env.TEST_SEEDPHRASE

describe('E2E: Seedphrase Import', () => {
  let sdk: Vultisig

  beforeAll(async () => {
    if (!TEST_SEEDPHRASE) {
      console.warn('⚠️  TEST_SEEDPHRASE not set in environment, some tests will be skipped')
    }

    console.log('🔧 Initializing Vultisig SDK...')
    const startTime = Date.now()

    sdk = new Vultisig({
      storage: new MemoryStorage(),
      autoInit: false,
    })
    await sdk.initialize()

    const initTime = Date.now() - startTime
    console.log(`✅ SDK initialized in ${initTime}ms`)
  })

  describe('API Surface', () => {
    it('should expose all seedphrase methods', () => {
      expect(typeof sdk.validateSeedphrase).toBe('function')
      expect(typeof sdk.discoverChainsFromSeedphrase).toBe('function')
      expect(typeof sdk.createFastVaultFromSeedphrase).toBe('function')
      expect(typeof sdk.createSecureVaultFromSeedphrase).toBe('function')
    })
  })

  describe('Seedphrase Validation', () => {
    it('should validate a correct 12-word mnemonic', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Validating seedphrase...')
      const result = await sdk.validateSeedphrase(TEST_SEEDPHRASE)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBeGreaterThanOrEqual(12)
      console.log(`✅ Valid ${result.wordCount}-word mnemonic`)
    })

    it('should reject an invalid mnemonic', async () => {
      const invalidMnemonic =
        'invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid'
      const result = await sdk.validateSeedphrase(invalidMnemonic)

      expect(result.valid).toBe(false)
      expect(result.error).toBeTruthy()
      console.log(`✅ Correctly rejected invalid mnemonic: ${result.error}`)
    })

    it('should handle uppercase and extra whitespace', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      const messyMnemonic = TEST_SEEDPHRASE.toUpperCase().split(' ').join('   ')
      const result = await sdk.validateSeedphrase(messyMnemonic)

      expect(result.valid).toBe(true)
      console.log('✅ Handled messy formatting correctly')
    })

    it('should reject wrong word count', async () => {
      const shortMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await sdk.validateSeedphrase(shortMnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(11)
      console.log('✅ Correctly rejected 11-word mnemonic')
    })
  })

  describe('Chain Discovery', () => {
    it('should discover chains and report progress', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Discovering chains from seedphrase...')
      const progressUpdates: ChainDiscoveryProgress[] = []

      const { results } = await sdk.discoverChainsFromSeedphrase(
        TEST_SEEDPHRASE,
        [Chain.Bitcoin, Chain.Ethereum],
        progress => {
          progressUpdates.push(progress)
          console.log(`  📊 ${progress.chain}: ${progress.phase}`)
        }
      )

      // Should have results for requested chains
      expect(results.length).toBe(2)

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)

      // Check result structure
      for (const result of results) {
        expect(result).toHaveProperty('chain')
        expect(result).toHaveProperty('address')
        expect(result).toHaveProperty('balance')
        expect(result).toHaveProperty('hasBalance')
        console.log(`  💰 ${result.chain}: ${result.address.slice(0, 20)}... balance=${result.balance}`)
      }
    })

    it('should derive valid addresses for chains', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Deriving addresses for multiple chains...')
      const { results } = await sdk.discoverChainsFromSeedphrase(TEST_SEEDPHRASE, [
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.Solana,
      ])

      const btcResult = results.find(r => r.chain === Chain.Bitcoin)
      const ethResult = results.find(r => r.chain === Chain.Ethereum)
      const solResult = results.find(r => r.chain === Chain.Solana)

      // Validate address formats
      expect(btcResult?.address).toMatch(/^bc1[a-z0-9]{39,59}$/)
      expect(ethResult?.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(solResult?.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)

      console.log(`  ₿ BTC: ${btcResult?.address}`)
      console.log(`  ⟠ ETH: ${ethResult?.address}`)
      console.log(`  ◎ SOL: ${solResult?.address}`)
    })
  })

  describe('Balance Checking', () => {
    it('should fetch Bitcoin balance from seedphrase', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Fetching Bitcoin balance...')
      const { results } = await sdk.discoverChainsFromSeedphrase(TEST_SEEDPHRASE, [Chain.Bitcoin])

      const btcResult = results.find(r => r.chain === Chain.Bitcoin)
      expect(btcResult).toBeDefined()
      expect(btcResult?.address).toMatch(/^bc1[a-z0-9]{39,59}$/)
      expect(typeof btcResult?.balance).toBe('string')

      const balance = parseFloat(btcResult?.balance || '0')
      console.log(`  ₿ BTC Address: ${btcResult?.address}`)
      console.log(`  ₿ BTC Balance: ${btcResult?.balance}`)
      console.log(`  ₿ Has Balance: ${btcResult?.hasBalance}`)

      // Verify balance is a valid number
      expect(balance).toBeGreaterThanOrEqual(0)
    })

    it('should fetch Ethereum balance from seedphrase', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Fetching Ethereum balance...')
      const { results } = await sdk.discoverChainsFromSeedphrase(TEST_SEEDPHRASE, [Chain.Ethereum])

      const ethResult = results.find(r => r.chain === Chain.Ethereum)
      expect(ethResult).toBeDefined()
      expect(ethResult?.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(typeof ethResult?.balance).toBe('string')

      const balance = parseFloat(ethResult?.balance || '0')
      console.log(`  ⟠ ETH Address: ${ethResult?.address}`)
      console.log(`  ⟠ ETH Balance: ${ethResult?.balance}`)
      console.log(`  ⟠ Has Balance: ${ethResult?.hasBalance}`)

      // Verify balance is a valid number
      expect(balance).toBeGreaterThanOrEqual(0)
    })

    it('should fetch THORChain balance from seedphrase', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Fetching THORChain balance...')
      const { results } = await sdk.discoverChainsFromSeedphrase(TEST_SEEDPHRASE, [Chain.THORChain])

      const runeResult = results.find(r => r.chain === Chain.THORChain)
      expect(runeResult).toBeDefined()
      expect(runeResult?.address).toMatch(/^thor[a-z0-9]{38,}$/)
      expect(typeof runeResult?.balance).toBe('string')

      const balance = parseFloat(runeResult?.balance || '0')
      console.log(`  ⚡ RUNE Address: ${runeResult?.address}`)
      console.log(`  ⚡ RUNE Balance: ${runeResult?.balance}`)
      console.log(`  ⚡ Has Balance: ${runeResult?.hasBalance}`)

      // Verify balance is a valid number
      expect(balance).toBeGreaterThanOrEqual(0)
    })

    it('should fetch all three chain balances together', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      console.log('🔍 Fetching BTC, ETH, and RUNE balances...')
      const { results } = await sdk.discoverChainsFromSeedphrase(TEST_SEEDPHRASE, [
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.THORChain,
      ])

      expect(results.length).toBe(3)

      const btcResult = results.find(r => r.chain === Chain.Bitcoin)
      const ethResult = results.find(r => r.chain === Chain.Ethereum)
      const runeResult = results.find(r => r.chain === Chain.THORChain)

      console.log('\n  📊 Balance Summary:')
      console.log(`  ₿ BTC:  ${btcResult?.balance} (${btcResult?.hasBalance ? 'has funds' : 'empty'})`)
      console.log(`  ⟠ ETH:  ${ethResult?.balance} (${ethResult?.hasBalance ? 'has funds' : 'empty'})`)
      console.log(`  ⚡ RUNE: ${runeResult?.balance} (${runeResult?.hasBalance ? 'has funds' : 'empty'})`)

      // At least one should have a balance based on user's seedphrase
      const hasAnyBalance = btcResult?.hasBalance || ethResult?.hasBalance || runeResult?.hasBalance
      console.log(`\n  💰 Has any balance: ${hasAnyBalance}`)
    })
  })

  describe('FastVault from Seedphrase', () => {
    it('should validate mnemonic before creation', async () => {
      // Invalid mnemonic should throw
      await expect(
        sdk.createFastVaultFromSeedphrase({
          mnemonic: 'invalid mnemonic words',
          name: 'Test Vault',
          password: 'testPassword123',
          email: 'test@example.com',
        })
      ).rejects.toThrow()

      console.log('✅ Correctly rejected invalid mnemonic for creation')
    })

    it('should report progress during creation initialization', async () => {
      if (!TEST_SEEDPHRASE) {
        console.log('⏭️  Skipping: TEST_SEEDPHRASE not set')
        return
      }

      const progressSteps: string[] = []

      // Note: This test will fail at the MPC coordination step since we don't have
      // a real VultiServer. This is expected - we're testing the pre-MPC flow.
      console.log('🔧 Testing creation progress reporting...')
      try {
        await sdk.createFastVaultFromSeedphrase({
          mnemonic: TEST_SEEDPHRASE,
          name: 'Test Vault',
          password: 'testPassword123',
          email: 'test@example.com',
          onProgress: step => {
            progressSteps.push(step.step)
            console.log(`  📊 Progress: ${step.step}`)
          },
        })
      } catch (error) {
        // Expected to fail at MPC step without real server
        console.log(`  ⚠️  Expected failure at MPC step: ${(error as Error).message}`)
      }

      // Should have reported at least the initializing step before failure
      expect(progressSteps.length).toBeGreaterThan(0)
      expect(progressSteps).toContain('initializing')
      console.log(`✅ Reported ${progressSteps.length} progress steps before MPC failure`)
    })
  })
})
