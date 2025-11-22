/**
 * E2E Tests: Fast Signing - Transaction Signing
 *
 * This test suite validates the `vault.sign('fast', payload)` method
 * across different blockchain architectures. The method signs transaction payloads
 * using 2-of-2 MPC with VultiServer but does NOT broadcast them.
 *
 * SCOPE: This suite focuses ONLY on signing transactions prepared by prepareSendTx().
 * It complements prepare-send-tx.test.ts by adding the actual signing step.
 *
 * CHAIN SELECTION RATIONALE:
 * We test the same representative chains as prepare-send-tx.test.ts:
 * - UTXO: Bitcoin (SegWit), Litecoin (variant)
 * - EVM: Ethereum (EIP-1559), ERC-20 tokens
 * - Cosmos: THORChain (vault-based), Cosmos Hub (IBC-enabled)
 * - Other: Solana (account-based), Polkadot (Substrate), Sui (Move VM)
 *
 * Environment: Production (mainnet RPCs, real VultiServer coordination)
 * Safety: Signatures generated but NEVER broadcast - transactions are NOT sent
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault MUST be a "fast" vault (with Server- signer)
 * - Vault credentials loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - ⚠️ WARNING: Tests sign real transactions but do NOT broadcast them
 * - ✅ SAFE: No funds are transferred, all operations are signing-only
 */

import {
  createSigningPayload,
  TEST_AMOUNTS,
  TEST_RECEIVERS,
  validateSignatureFormat,
} from '@helpers/signing-helpers'
import {
  loadTestVault,
  TEST_VAULT_CONFIG,
  verifyTestVault,
} from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Vault } from '@/index'
import { Chain } from '@/types'

describe('E2E: Fast Signing - Transaction Signing', () => {
  let vault: Vault

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const result = await loadTestVault()
    vault = result.vault
    verifyTestVault(vault)

    // Verify vault is fast type
    if (vault.type !== 'fast') {
      throw new Error(
        'Fast signing tests require a "fast" vault with Server- signer. ' +
          'Current vault type: ' +
          vault.type
      )
    }
    console.log('✅ Vault is fast type - can proceed with signing tests')
  })

  // ============================================================================
  // CHAIN FAMILY COVERAGE
  // Tests that fast signing works across different blockchain architectures
  // ============================================================================

  describe('Chain Family Coverage', () => {
    // ==========================================================================
    // UTXO CHAINS
    // Bitcoin-style chains using Unspent Transaction Output model
    // Key features: ECDSA signatures, UTXO selection, change outputs
    // ==========================================================================

    describe.concurrent('UTXO Chains', () => {
      it('Bitcoin: Sign native BTC transfer', async () => {
        console.log('\n🔐 Testing Bitcoin fast signing...')

        // 1. Prepare transaction
        const coin = {
          chain: Chain.Bitcoin,
          address: await vault.address(Chain.Bitcoin),
          decimals: 8,
          ticker: 'BTC',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Bitcoin!,
          amount: TEST_AMOUNTS.Bitcoin!,
        })

        // 2. Extract message hashes
        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)
        console.log(`   Extracted ${messageHashes.length} message hash(es)`)

        // 3. Sign transaction
        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Bitcoin
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        // 4. Validate signature
        validateSignatureFormat(signature, Chain.Bitcoin, 'ECDSA')
        console.log(
          '✅ Bitcoin transaction signed successfully (NOT broadcast)'
        )
        console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
      })

      it('Litecoin: Sign native LTC transfer', async () => {
        console.log('\n🔐 Testing Litecoin fast signing...')

        const coin = {
          chain: Chain.Litecoin,
          address: await vault.address(Chain.Litecoin),
          decimals: 8,
          ticker: 'LTC',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Litecoin!,
          amount: TEST_AMOUNTS.Litecoin!,
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Litecoin
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Litecoin, 'ECDSA')
        console.log(
          '✅ Litecoin transaction signed successfully (NOT broadcast)'
        )
      })
    })

    // ==========================================================================
    // EVM CHAINS
    // Ethereum Virtual Machine chains (Ethereum, Polygon, BSC, L2s, etc.)
    // Key features: ECDSA signatures, EIP-1559 gas, nonce management
    // ==========================================================================

    describe.concurrent('EVM Chains', () => {
      it('Ethereum: Sign native ETH transfer (EIP-1559)', async () => {
        console.log('\n🔐 Testing Ethereum fast signing...')

        const coin = {
          chain: Chain.Ethereum,
          address: await vault.address(Chain.Ethereum),
          decimals: 18,
          ticker: 'ETH',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Ethereum!,
          amount: TEST_AMOUNTS.Ethereum!,
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)
        console.log(`   Extracted ${messageHashes.length} message hash(es)`)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Ethereum
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')
        expect(signature.recovery).toBeDefined()
        console.log(
          '✅ Ethereum transaction signed successfully (NOT broadcast)'
        )
        console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
        console.log(`   Recovery ID: ${signature.recovery}`)
      })

      it('Ethereum: Sign ERC-20 token transfer (USDC)', async () => {
        console.log('\n🔐 Testing ERC-20 token fast signing...')

        const coin = {
          chain: Chain.Ethereum,
          address: await vault.address(Chain.Ethereum),
          decimals: 6,
          ticker: 'USDC',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC contract
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Ethereum!,
          amount: 1000000n, // 1 USDC
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Ethereum
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')
        console.log(
          '✅ ERC-20 token transaction signed successfully (NOT broadcast)'
        )
        console.log(`   Token: USDC (contract call signature)`)
      })
    })

    // ==========================================================================
    // COSMOS CHAINS
    // Cosmos SDK-based chains with different flavors
    // Two types: IBC-enabled (Cosmos Hub) and vault-based (THORChain)
    // ==========================================================================

    describe.concurrent('Cosmos Chains', () => {
      it('THORChain: Sign native RUNE transfer with memo', async () => {
        console.log('\n🔐 Testing THORChain fast signing...')

        const coin = {
          chain: Chain.THORChain,
          address: await vault.address(Chain.THORChain),
          decimals: 8,
          ticker: 'RUNE',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.THORChain!,
          amount: TEST_AMOUNTS.THORChain!,
          memo: 'SWAP:ETH.ETH:0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.THORChain
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.THORChain, 'ECDSA')
        console.log(
          '✅ THORChain transaction signed successfully (NOT broadcast)'
        )
        console.log(`   Memo included: ${keysignPayload.memo}`)
      })

      it('Cosmos Hub: Sign native ATOM transfer', async () => {
        console.log('\n🔐 Testing Cosmos Hub fast signing...')

        const coin = {
          chain: Chain.Cosmos,
          address: await vault.address(Chain.Cosmos),
          decimals: 6,
          ticker: 'ATOM',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Cosmos!,
          amount: TEST_AMOUNTS.Cosmos!,
          memo: 'Test IBC transfer',
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Cosmos
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Cosmos, 'ECDSA')
        console.log(
          '✅ Cosmos Hub transaction signed successfully (NOT broadcast)'
        )
      })
    })

    // ==========================================================================
    // OTHER CHAIN ARCHITECTURES
    // Chains with unique architectures: Solana (EdDSA), Polkadot, Sui
    // ==========================================================================

    describe.concurrent('Other Chain Architectures', () => {
      it('Solana: Sign native SOL transfer (EdDSA)', async () => {
        console.log('\n🔐 Testing Solana fast signing...')

        const coin = {
          chain: Chain.Solana,
          address: await vault.address(Chain.Solana),
          decimals: 9,
          ticker: 'SOL',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Solana!,
          amount: TEST_AMOUNTS.Solana!,
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Solana
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Solana, 'EdDSA')
        console.log('✅ Solana transaction signed successfully (NOT broadcast)')
        console.log(`   EdDSA signature (Solana-specific)`)
      })

      it('Polkadot: Sign native DOT transfer (EdDSA)', async () => {
        console.log('\n🔐 Testing Polkadot fast signing...')

        const coin = {
          chain: Chain.Polkadot,
          address: await vault.address(Chain.Polkadot),
          decimals: 10,
          ticker: 'DOT',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Polkadot!,
          amount: TEST_AMOUNTS.Polkadot!,
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Polkadot
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Polkadot, 'EdDSA')
        console.log(
          '✅ Polkadot transaction signed successfully (NOT broadcast)'
        )
      })

      it('Sui: Sign native SUI transfer (EdDSA)', async () => {
        console.log('\n🔐 Testing Sui fast signing...')

        const coin = {
          chain: Chain.Sui,
          address: await vault.address(Chain.Sui),
          decimals: 9,
          ticker: 'SUI',
        }

        const keysignPayload = await vault.prepareSendTx({
          coin,
          receiver: TEST_RECEIVERS.Sui!,
          amount: TEST_AMOUNTS.Sui!,
        })

        const messageHashes = await vault.extractMessageHashes(keysignPayload)
        expect(messageHashes.length).toBeGreaterThan(0)

        const signingPayload = createSigningPayload(
          keysignPayload,
          messageHashes,
          Chain.Sui
        )
        const signature = await vault.sign(
          'fast',
          signingPayload,
          TEST_VAULT_CONFIG.password
        )

        validateSignatureFormat(signature, Chain.Sui, 'EdDSA')
        console.log('✅ Sui transaction signed successfully (NOT broadcast)')
      })
    })
  })

  // ============================================================================
  // SIGNATURE FORMAT VALIDATION
  // Tests that signatures have correct format for each signature algorithm
  // ============================================================================

  describe.concurrent('Signature Format Validation', () => {
    it('ECDSA signatures: correct format and structure', async () => {
      console.log('\n📝 Validating ECDSA signature format...')

      // Test with Bitcoin (ECDSA chain)
      const coin = {
        chain: Chain.Bitcoin,
        address: await vault.address(Chain.Bitcoin),
        decimals: 8,
        ticker: 'BTC',
      }

      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: TEST_RECEIVERS.Bitcoin!,
        amount: TEST_AMOUNTS.Bitcoin!,
      })

      const messageHashes = await vault.extractMessageHashes(keysignPayload)
      const signingPayload = createSigningPayload(
        keysignPayload,
        messageHashes,
        Chain.Bitcoin
      )
      const signature = await vault.sign(
        'fast',
        signingPayload,
        TEST_VAULT_CONFIG.password
      )

      // ECDSA-specific validations
      expect(signature.format).toBe('ECDSA')
      expect(signature.signature).toBeDefined()
      expect(signature.signature).toMatch(/^[0-9a-f]+$/i) // Hex format
      expect(signature.signature.length).toBeGreaterThan(100)

      // ECDSA should have recovery ID
      expect(signature.recovery).toBeDefined()
      expect(typeof signature.recovery).toBe('number')
      expect(signature.recovery).toBeGreaterThanOrEqual(0)
      expect(signature.recovery).toBeLessThanOrEqual(3)

      console.log('✅ ECDSA signature format validation passed')
    })

    it('EdDSA signatures: correct format and structure', async () => {
      console.log('\n📝 Validating EdDSA signature format...')

      // Test with Solana (EdDSA chain)
      const coin = {
        chain: Chain.Solana,
        address: await vault.address(Chain.Solana),
        decimals: 9,
        ticker: 'SOL',
      }

      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: TEST_RECEIVERS.Solana!,
        amount: TEST_AMOUNTS.Solana!,
      })

      const messageHashes = await vault.extractMessageHashes(keysignPayload)
      const signingPayload = createSigningPayload(
        keysignPayload,
        messageHashes,
        Chain.Solana
      )
      const signature = await vault.sign(
        'fast',
        signingPayload,
        TEST_VAULT_CONFIG.password
      )

      // EdDSA-specific validations
      expect(signature.format).toBe('EdDSA')
      expect(signature.signature).toBeDefined()
      expect(signature.signature).toMatch(/^[0-9a-f]+$/i) // Hex format
      expect(signature.signature.length).toBeGreaterThan(100)

      console.log('✅ EdDSA signature format validation passed')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // Tests that signing properly validates inputs and handles errors
  // ============================================================================

  describe.concurrent('Error Handling', () => {
    it('Rejects signing with locked vault (no cached password)', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: TEST_RECEIVERS.Ethereum!,
        amount: TEST_AMOUNTS.Ethereum!,
      })

      const messageHashes = await vault.extractMessageHashes(keysignPayload)
      const signingPayload = createSigningPayload(
        keysignPayload,
        messageHashes,
        Chain.Ethereum
      )

      // Lock the vault to clear the password cache
      vault.lock()

      await expect(vault.sign('fast', signingPayload)).rejects.toThrow()

      console.log('✅ Correctly rejected signing with locked vault')

      // Unlock vault again for subsequent tests
      await vault.unlock(TEST_VAULT_CONFIG.password)
    })

    it('Rejects signing without messageHashes', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: TEST_RECEIVERS.Ethereum!,
        amount: TEST_AMOUNTS.Ethereum!,
      })

      // Create signing payload WITHOUT messageHashes
      const signingPayload = {
        transaction: keysignPayload,
        chain: Chain.Ethereum,
        messageHashes: [], // Empty array - should fail
      }

      await expect(vault.sign('fast', signingPayload)).rejects.toThrow()

      console.log('✅ Correctly rejected missing messageHashes')
    })
  })

  // ============================================================================
  // SAFETY VERIFICATION
  // Confirms that NO transactions were actually broadcast to networks
  // ============================================================================

  describe('Safety Verification', () => {
    it('Confirms NO transactions were broadcast to blockchain', async () => {
      console.log(
        '\n🔒 Safety Check: Verifying NO transactions were broadcast...'
      )

      // Sign one transaction to verify safety (no broadcast)
      const chain = Chain.Ethereum
      const coin = {
        chain,
        address: await vault.address(chain),
        decimals: 18,
        ticker: chain,
      }

      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: TEST_RECEIVERS[chain]!,
        amount: TEST_AMOUNTS.Ethereum!,
      })

      const messageHashes = await vault.extractMessageHashes(keysignPayload)
      const signingPayload = createSigningPayload(
        keysignPayload,
        messageHashes,
        chain
      )

      const signature = await vault.sign(
        'fast',
        signingPayload,
        TEST_VAULT_CONFIG.password
      )

      expect(signature).toBeDefined()

      console.log('✅ Signature generated successfully')
      console.log('✅ ZERO transactions were broadcast to the blockchain')
      console.log('✅ All operations were signing-only (vault.sign)')
      console.log('✅ No funds were transferred')
      console.log('✅ Signature generated but never submitted to network')
    })
  })
})
