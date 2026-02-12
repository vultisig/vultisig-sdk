/**
 * Integration Test: Multi-Chain Address Derivation
 *
 * This test verifies that ALL supported chains can derive valid addresses
 * using the PUBLIC SDK API with REAL WASM modules.
 *
 * IMPORTANT: Uses ONLY public SDK API (Vultisig class)
 * This is a true integration test - testing the SDK as users would use it.
 *
 * Test Coverage:
 * - All 40+ blockchain chains
 * - Chain families: UTXO, EVM, Cosmos, EdDSA-based
 * - Address format validation
 * - Address caching behavior
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { Chain } from '@core/chain/Chain'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createSdkContext, type SdkContext } from '../../../src/context/SdkContextBuilder'
import { FastSigningService } from '../../../src/services/FastSigningService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { FastVault } from '../../../src/vault/FastVault'
import { Vultisig } from '../../../src/Vultisig'

/**
 * ALL SUPPORTED CHAINS
 * Extracted from Chain enum to test EVERY chain
 */
const ALL_CHAINS = Object.values(Chain)

console.log(`\n🔍 Testing ${ALL_CHAINS.length} blockchain chains\n`)

/**
 * Chain-specific address validators
 * Each chain has unique address format requirements
 */
const CHAIN_VALIDATORS: Record<string, (address: string) => boolean> = {
  // UTXO Chains
  Bitcoin: addr => /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr),
  Litecoin: addr => /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr),
  Dogecoin: addr => /^D[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),
  'Bitcoin-Cash': addr =>
    /^(bitcoincash:|q)[a-zA-HJ-NP-Z0-9]{40,45}$/.test(addr) || /^[13][a-zA-HJ-NP-Z0-9]{25,34}$/.test(addr),
  Dash: addr => /^X[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),
  Zcash: addr => /^(t1|t3)[a-zA-HJ-NP-Z0-9]{33}$/.test(addr),

  // EVM Chains (all share same address format)
  Ethereum: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Polygon: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  BSC: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Avalanche: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  CronosChain: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Arbitrum: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Base: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Blast: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Optimism: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Zksync: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),
  Mantle: addr => /^0x[a-fA-F0-9]{40}$/.test(addr),

  // Cosmos Chains
  Cosmos: addr => /^cosmos1[a-z0-9]{38,}$/.test(addr),
  THORChain: addr => /^thor1[a-z0-9]{38,}$/.test(addr),
  MayaChain: addr => /^maya1[a-z0-9]{38,}$/.test(addr),
  Osmosis: addr => /^osmo1[a-z0-9]{38,}$/.test(addr),
  Dydx: addr => /^dydx1[a-z0-9]{38,}$/.test(addr),
  Kujira: addr => /^kujira1[a-z0-9]{38,}$/.test(addr),
  Terra: addr => /^terra1[a-z0-9]{38,}$/.test(addr),
  TerraClassic: addr => /^terra1[a-z0-9]{38,}$/.test(addr),
  Noble: addr => /^noble1[a-z0-9]{38,}$/.test(addr),
  Akash: addr => /^akash1[a-z0-9]{38,}$/.test(addr),

  // EdDSA & Other Chains
  Solana: addr => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
  Sui: addr => /^0x[a-f0-9]{64}$/.test(addr),
  Polkadot: addr => /^1[a-zA-HJ-NP-Z0-9]{47}$/.test(addr),
  Ton: addr => /^[UE][Qf][a-zA-Z0-9_-]{46}$/.test(addr),
  Ripple: addr => /^r[a-zA-Z0-9]{24,34}$/.test(addr),
  Tron: addr => /^T[a-zA-Z0-9]{33}$/.test(addr),
  Cardano: addr => /^addr1[a-z0-9]{53,}$/.test(addr),
}

describe('Integration: Multi-Chain Address Derivation', () => {
  let sdk: Vultisig
  let vault: FastVault
  let memoryStorage: MemoryStorage
  let context: SdkContext

  beforeAll(async () => {
    // Create fresh storage
    memoryStorage = new MemoryStorage()

    // Create SDK context with all dependencies
    context = createSdkContext({
      storage: memoryStorage,
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: 'https://api.vultisig.com/router',
      },
      defaultChains: ALL_CHAINS,
      defaultCurrency: 'USD',
    })

    // Initialize SDK with WASM
    sdk = new Vultisig({
      storage: memoryStorage,
      defaultChains: ALL_CHAINS,
    })

    await sdk.initialize()

    // Create a vault directly with mock data (no MPC keygen needed for address derivation)
    const now = Date.now()
    const mockVaultData: CoreVault = {
      name: 'Integration Test Vault',
      publicKeys: {
        // Real-ish looking public keys (proper format for address derivation)
        ecdsa: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
        eddsa: 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
      },
      hexChainCode: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      localPartyId: 'test-device',
      signers: ['test-device', 'Server-1'],
      keyShares: {
        ecdsa: 'mock_ecdsa_keyshare',
        eddsa: 'mock_eddsa_keyshare',
      },
      resharePrefix: '',
      libType: 'GG20',
      createdAt: now,
      isBackedUp: false,
      order: 0,
    } as CoreVault

    // Create mock VaultData with correct structure
    const vaultData = {
      // Identity (readonly fields)
      publicKeys: mockVaultData.publicKeys,
      hexChainCode: mockVaultData.hexChainCode,
      signers: mockVaultData.signers,
      localPartyId: mockVaultData.localPartyId,
      createdAt: now,
      libType: mockVaultData.libType,
      isEncrypted: false,
      type: 'fast' as const,
      // Metadata
      id: mockVaultData.publicKeys.ecdsa, // Use ECDSA public key as ID
      name: 'Integration Test Vault',
      isBackedUp: false,
      order: 0,
      lastModified: now,
      // User Preferences
      currency: 'usd',
      chains: ALL_CHAINS.map(c => c.toString()),
      tokens: {},
      // Vault file
      vultFileContent: '',
    }

    // Create FastSigningService with context dependencies
    const fastSigningService = new FastSigningService(context.serverManager, context.wasmProvider)

    // Create VaultContext from SdkContext
    const vaultContext = {
      storage: context.storage,
      config: context.config,
      serverManager: context.serverManager,
      passwordCache: context.passwordCache,
      wasmProvider: context.wasmProvider,
    }

    vault = FastVault.fromStorage(vaultData, fastSigningService, vaultContext)

    console.log('✅ SDK initialized and vault created with REAL WASM')
    console.log(`   Testing ${ALL_CHAINS.length} chains\n`)
  }, 60000) // Allow 60 seconds for WASM initialization

  afterAll(() => {
    sdk?.dispose()
    context.passwordCache.destroy()
  })

  /**
   * CRITICAL TEST: Verify EVERY chain can derive a valid address
   *
   * This test is parameterized to run once per chain, providing clear
   * visibility into which chains pass and which fail.
   */
  describe.each(ALL_CHAINS)('Chain: %s', chain => {
    it(`should derive a valid ${chain} address`, async () => {
      // Derive address using public API
      const address = await vault.address(chain)

      // Basic validations
      expect(address, `${chain} address should be defined`).toBeDefined()
      expect(typeof address, `${chain} address should be a string`).toBe('string')
      expect(address.length, `${chain} address should not be empty`).toBeGreaterThan(0)

      // Chain-specific validation
      const validator = CHAIN_VALIDATORS[chain]
      if (validator) {
        expect(validator(address), `${chain} address "${address}" should match expected format`).toBe(true)
      } else {
        // Fallback: at least check for reasonable length
        expect(address.length, `${chain} address should have reasonable length (20+ chars)`).toBeGreaterThanOrEqual(20)

        console.warn(`⚠️  No validator for ${chain}, only checked length. Address: ${address}`)
      }

      console.log(`✅ ${chain.padEnd(20)} → ${address}`)
    }, 30000) // 30 second timeout per chain

    it(`should cache ${chain} address permanently`, async () => {
      // First call
      const address1 = await vault.address(chain)

      // Second call - should return cached address
      const address2 = await vault.address(chain)

      expect(address1).toBe(address2)
    })
  })

  /**
   * Test EVM chain address consistency
   * All EVM chains should derive the SAME address (same public key)
   */
  describe('EVM Chain Family Consistency', () => {
    const evmChains = [
      Chain.Ethereum,
      Chain.Polygon,
      Chain.BSC,
      Chain.Avalanche,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Base,
      Chain.Blast,
      Chain.Zksync,
      Chain.Mantle,
      Chain.CronosChain,
    ]

    it('should derive identical addresses for all EVM chains', async () => {
      const addresses = await Promise.all(
        evmChains.map(async chain => ({
          chain,
          address: await vault.address(chain),
        }))
      )

      // All addresses should be identical
      const firstAddress = addresses[0].address
      addresses.forEach(({ chain, address }) => {
        expect(address, `${chain} should have same address as Ethereum`).toBe(firstAddress)
      })

      console.log(`\n✅ All ${evmChains.length} EVM chains share address: ${firstAddress}`)
    })
  })

  /**
   * Test Cosmos chain address prefix correctness
   * Each Cosmos chain has a unique bech32 prefix
   */
  describe('Cosmos Chain Prefix Validation', () => {
    const cosmosPrefixes: Record<string, string> = {
      [Chain.Cosmos]: 'cosmos1',
      [Chain.THORChain]: 'thor1',
      [Chain.MayaChain]: 'maya1',
      [Chain.Osmosis]: 'osmo1',
      [Chain.Dydx]: 'dydx1',
      [Chain.Kujira]: 'kujira1',
      [Chain.Terra]: 'terra1',
      [Chain.TerraClassic]: 'terra1',
      [Chain.Noble]: 'noble1',
      [Chain.Akash]: 'akash1',
    }

    Object.entries(cosmosPrefixes).forEach(([chain, expectedPrefix]) => {
      it(`should derive ${chain} address with correct prefix "${expectedPrefix}"`, async () => {
        const address = await vault.address(chain as Chain)

        expect(address.startsWith(expectedPrefix), `${chain} address should start with "${expectedPrefix}"`).toBe(true)
      })
    })
  })

  /**
   * Reproduce BCH bug: passing enum key 'BitcoinCash' instead of enum value 'Bitcoin-Cash'
   * BCH is the only chain where key !== value, so only BCH triggers this failure.
   */
  describe('BCH enum key mismatch', () => {
    it('should fail when passing "BitcoinCash" instead of Chain.BitcoinCash ("Bitcoin-Cash")', async () => {
      try {
        await vault.address('BitcoinCash' as Chain)
        expect.unreachable('should have thrown')
      } catch (error: any) {
        // After the match() guard, the inner error now clearly identifies the bad value
        expect(error.originalError?.message).toMatch(/No match handler for: "BitcoinCash"/)
      }
    })
  })

  /**
   * Batch address derivation performance test
   */
  describe('Batch Derivation Performance', () => {
    it('should derive all chain addresses efficiently', async () => {
      const startTime = Date.now()

      // Derive addresses for all chains in parallel
      const results = await Promise.all(
        ALL_CHAINS.map(async chain => ({
          chain,
          address: await vault.address(chain),
        }))
      )

      const duration = Date.now() - startTime

      // Verify we got addresses for all chains
      expect(results.length).toBe(ALL_CHAINS.length)

      // All addresses should be defined
      results.forEach(({ chain, address }) => {
        expect(address, `${chain} should have an address`).toBeDefined()
        expect(address.length).toBeGreaterThan(0)
      })

      console.log(`\n⚡ Derived ${ALL_CHAINS.length} addresses in ${duration}ms`)
      console.log(`   Average: ${(duration / ALL_CHAINS.length).toFixed(2)}ms per chain`)

      // Should complete within reasonable time (10 seconds for 40+ chains)
      expect(duration).toBeLessThan(10000)
    }, 15000)
  })
})
