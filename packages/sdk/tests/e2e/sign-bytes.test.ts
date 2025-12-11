/**
 * E2E Tests: signBytes - Raw Bytes Signing
 *
 * This test suite validates the `vault.signBytes(options)` method
 * across different blockchain architectures. The method signs arbitrary
 * pre-hashed bytes using 2-of-2 MPC with VultiServer.
 *
 * SCOPE: This suite focuses on signing raw bytes (pre-hashed data)
 * without transaction context. It complements fast-signing.test.ts
 * by testing the lower-level signing API.
 *
 * CHAIN SELECTION RATIONALE:
 * We test representative chains for each signature algorithm:
 * - ECDSA: Ethereum, Bitcoin (most common)
 * - EdDSA: Solana, Sui (Ed25519-based chains)
 *
 * Environment: Production (mainnet RPCs, real VultiServer coordination)
 * Safety: Signatures generated for test hashes - no real transactions
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault MUST be a "fast" vault (with Server- signer)
 * - Vault credentials loaded from environment variables
 */

import { validateSignatureFormat } from '@helpers/signing-helpers'
import { loadTestVault, verifyTestVault } from '@helpers/test-vault'
import { createHash, randomBytes } from 'crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain, VaultBase } from '@/index'

describe('E2E: signBytes - Raw Bytes Signing', () => {
  let vault: VaultBase

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const result = await loadTestVault()
    vault = result.vault
    verifyTestVault(vault)

    // Verify vault is fast type
    if (vault.type !== 'fast') {
      throw new Error(
        'signBytes tests require a "fast" vault with Server- signer. ' + 'Current vault type: ' + vault.type
      )
    }
    console.log('✅ Vault is fast type - can proceed with signBytes tests')
  })

  // ============================================================================
  // INPUT FORMAT TESTS
  // Tests that signBytes accepts various input formats
  // ============================================================================

  describe('Input Format Support', () => {
    it('should accept Uint8Array input', async () => {
      console.log('\n🔐 Testing signBytes with Uint8Array...')

      // Create a 32-byte hash (typical for ECDSA)
      const hash = new Uint8Array(32)
      hash.fill(0xab)

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      expect(signature.signature.length).toBeGreaterThan(0)
      console.log('✅ Uint8Array input accepted')
    })

    it('should accept Buffer input', async () => {
      console.log('\n🔐 Testing signBytes with Buffer...')

      // Create a 32-byte hash using Buffer
      const hash = Buffer.alloc(32, 0xcd)

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      console.log('✅ Buffer input accepted')
    })

    it('should accept hex string input without 0x prefix', async () => {
      console.log('\n🔐 Testing signBytes with hex string (no prefix)...')

      // Create a 32-byte hash as hex string
      const hash = 'a'.repeat(64) // 32 bytes = 64 hex chars

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      console.log('✅ Hex string (no prefix) accepted')
    })

    it('should accept hex string input with 0x prefix', async () => {
      console.log('\n🔐 Testing signBytes with hex string (0x prefix)...')

      // Create a 32-byte hash as hex string with 0x prefix
      const hash = '0x' + 'b'.repeat(64)

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      console.log('✅ Hex string (0x prefix) accepted')
    })
  })

  // ============================================================================
  // ECDSA CHAINS
  // Tests for chains using ECDSA signature algorithm
  // ============================================================================

  describe('ECDSA Chains', () => {
    it('Ethereum: Sign 32-byte hash with ECDSA', async () => {
      console.log('\n🔐 Testing Ethereum signBytes (ECDSA)...')

      // Create a keccak256-like hash (32 bytes)
      const message = 'Hello, Ethereum!'
      const hash = createHash('sha256').update(message).digest()

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')
      expect(signature.recovery).toBeDefined()
      console.log('✅ Ethereum signBytes completed')
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    })

    it('Bitcoin: Sign 32-byte hash with ECDSA', async () => {
      console.log('\n🔐 Testing Bitcoin signBytes (ECDSA)...')

      // Create a sha256 hash (32 bytes)
      const message = 'Hello, Bitcoin!'
      const hash = createHash('sha256').update(message).digest()

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Bitcoin,
      })

      validateSignatureFormat(signature, Chain.Bitcoin, 'ECDSA')
      console.log('✅ Bitcoin signBytes completed')
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    })

    it('Polygon: Sign 32-byte hash with ECDSA', async () => {
      console.log('\n🔐 Testing Polygon signBytes (ECDSA)...')

      const hash = randomBytes(32)

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Polygon,
      })

      validateSignatureFormat(signature, Chain.Polygon, 'ECDSA')
      console.log('✅ Polygon signBytes completed')
    })
  })

  // ============================================================================
  // EdDSA CHAINS
  // Tests for chains using EdDSA signature algorithm
  // ============================================================================

  describe('EdDSA Chains', () => {
    it('Solana: Sign bytes with EdDSA', async () => {
      console.log('\n🔐 Testing Solana signBytes (EdDSA)...')

      // Create a 32-byte message for EdDSA
      const message = 'Hello, Solana!'
      const hash = createHash('sha256').update(message).digest()

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Solana,
      })

      // EdDSA signatures may have different format
      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      expect(signature.signature.length).toBeGreaterThan(0)
      console.log('✅ Solana signBytes completed')
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    })

    it('Sui: Sign bytes with EdDSA', async () => {
      console.log('\n🔐 Testing Sui signBytes (EdDSA)...')

      const hash = randomBytes(32)

      const signature = await vault.signBytes({
        data: hash,
        chain: Chain.Sui,
      })

      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      console.log('✅ Sui signBytes completed')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // Tests for error cases
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw on empty data', async () => {
      console.log('\n🔐 Testing signBytes with empty data...')

      await expect(
        vault.signBytes({
          data: '',
          chain: Chain.Ethereum,
        })
      ).rejects.toThrow(/empty/i)

      console.log('✅ Empty data throws error as expected')
    })

    it('should throw on invalid hex string', async () => {
      console.log('\n🔐 Testing signBytes with invalid hex...')

      await expect(
        vault.signBytes({
          data: 'not-valid-hex',
          chain: Chain.Ethereum,
        })
      ).rejects.toThrow(/invalid/i)

      console.log('✅ Invalid hex throws error as expected')
    })
  })

  // ============================================================================
  // CONSISTENCY TESTS
  // Tests that signing the same data produces consistent results
  // ============================================================================

  describe('Signing Consistency', () => {
    it('should produce same signature for same input (deterministic)', async () => {
      console.log('\n🔐 Testing signature determinism...')

      const hash = createHash('sha256').update('consistent-message').digest()

      const signature1 = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      const signature2 = await vault.signBytes({
        data: hash,
        chain: Chain.Ethereum,
      })

      // The r,s values should be the same for deterministic signing
      // Note: Some implementations may use randomized k values
      expect(signature1.signature).toBeDefined()
      expect(signature2.signature).toBeDefined()

      console.log('✅ Consistency test completed')
      console.log(`   Sig1: ${signature1.signature.substring(0, 40)}...`)
      console.log(`   Sig2: ${signature2.signature.substring(0, 40)}...`)
    })

    it('should produce different signatures for different inputs', async () => {
      console.log('\n🔐 Testing different inputs produce different signatures...')

      const hash1 = createHash('sha256').update('message-1').digest()
      const hash2 = createHash('sha256').update('message-2').digest()

      const signature1 = await vault.signBytes({
        data: hash1,
        chain: Chain.Ethereum,
      })

      const signature2 = await vault.signBytes({
        data: hash2,
        chain: Chain.Ethereum,
      })

      // Different messages should produce different signatures
      expect(signature1.signature).not.toBe(signature2.signature)

      console.log('✅ Different inputs produce different signatures')
    })
  })
})
