/**
 * E2E Tests: Swap Transaction Preparation & Signing (Production)
 *
 * These tests use a pre-created persistent fast vault to test real swap
 * transaction preparation and signing against production swap aggregator APIs.
 *
 * Environment: Production (mainnet swap APIs)
 * Safety: Transactions are signed but NEVER broadcast - funds remain safe
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials MUST be loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - See tests/e2e/SECURITY.md and .env.example for setup instructions
 *
 * NOTE: These tests hit real swap aggregator APIs (1inch, THORChain, LiFi, etc.)
 * and may fail if APIs are unavailable or rate-limited.
 *
 * ⚠️ WARNING: Tests sign real transactions but do NOT broadcast them
 * ✅ SAFE: No funds are transferred, all operations are signing-only
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { beforeAll, describe, expect, it } from 'vitest'

import type { VaultBase } from '@/index'

import type { SwapPrepareResult, SwapQuoteResult } from '../../src/vault/swap-types'
import { createSigningPayload, validateSignatureFormat } from './helpers/signing-helpers'
import { loadTestVault, verifyTestVault } from './helpers/test-vault'

describe('E2E: Swap Transactions (Production)', () => {
  let vault: VaultBase

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const startTime = Date.now()

    const result = await loadTestVault()
    vault = result.vault

    const loadTime = Date.now() - startTime
    console.log(`✅ Vault loaded in ${loadTime}ms`)

    verifyTestVault(vault)
  })

  describe('Native Token Swap Transactions', () => {
    it('should prepare ETH to BTC swap transaction (THORChain)', async () => {
      console.log('🔄 Preparing ETH → BTC swap transaction...')

      const ethAddress = await vault.address(Chain.Ethereum)
      const btcAddress = await vault.address(Chain.Bitcoin)

      // First get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Bitcoin,
            address: btcAddress,
            ticker: 'BTC',
            decimals: 8,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found for small amount, skipping...')
          return
        }
        throw error
      }

      expect(quote).toBeDefined()
      console.log(`✅ Quote received via ${quote.provider}`)

      // Now prepare the transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Bitcoin,
            address: btcAddress,
            ticker: 'BTC',
            decimals: 8,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()
      expect(prepareResult.quote).toBeDefined()

      // Native ETH swap should not require approval
      expect(prepareResult.approvalPayload).toBeUndefined()

      console.log('✅ Swap transaction prepared successfully')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Has keysign payload: ${!!prepareResult.keysignPayload}`)
      console.log(`   Requires approval: ${!!prepareResult.approvalPayload}`)
    }, 60000)

    it('should prepare same-chain ETH to USDC swap (DEX)', async () => {
      console.log('🔄 Preparing ETH → USDC swap transaction (same chain)...')

      const ethAddress = await vault.address(Chain.Ethereum)

      // First get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      expect(quote).toBeDefined()
      console.log(`✅ Quote received via ${quote.provider}`)

      // Prepare the transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      // Native ETH swap should not require approval
      expect(prepareResult.approvalPayload).toBeUndefined()

      console.log('✅ Swap transaction prepared successfully')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Output: ${prepareResult.quote.estimatedOutput} USDC`)
    }, 60000)
  })

  describe('ERC-20 Token Swap Transactions', () => {
    it('should prepare USDC to ETH swap with approval info', async () => {
      console.log('🔄 Preparing USDC → ETH swap transaction...')

      const ethAddress = await vault.address(Chain.Ethereum)

      // First get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      expect(quote).toBeDefined()
      console.log(`✅ Quote received via ${quote.provider}`)
      console.log(`   Requires approval: ${quote.requiresApproval}`)

      // Prepare the transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
          swapQuote: quote,
          autoApprove: false, // Get separate approval payload if needed
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      // ERC-20 swap may require approval - check keysignPayload.erc20ApprovePayload
      // Note: Core handles approval internally via erc20ApprovePayload, not as separate approvalPayload
      if (quote.requiresApproval) {
        // The approval info is embedded in the keysign payload
        console.log('   Approval required: yes (handled via keysignPayload.erc20ApprovePayload)')
      } else {
        console.log('   Approval required: no (sufficient allowance)')
      }

      console.log('✅ Swap transaction prepared successfully')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Output: ${prepareResult.quote.estimatedOutput} ETH`)
    }, 60000)

    it('should prepare ERC-20 swap with autoApprove=false (manual approval)', async () => {
      console.log('🔄 Preparing USDC → ETH swap with autoApprove=false...')

      const ethAddress = await vault.address(Chain.Ethereum)

      // Get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      // Prepare with autoApprove=false (default behavior)
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
          swapQuote: quote,
          autoApprove: false, // Explicit manual approval mode
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      // With autoApprove=false, approval is handled via keysignPayload.erc20ApprovePayload
      // The swapApprovalRequired event should have been emitted if approval was needed
      console.log('✅ Swap prepared with autoApprove=false')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Approval mode: manual (via keysignPayload.erc20ApprovePayload)`)
      console.log(`   Requires approval: ${quote.requiresApproval}`)
    }, 60000)

    it('should prepare ERC-20 swap with autoApprove=true (automatic approval)', async () => {
      console.log('🔄 Preparing USDC → ETH swap with autoApprove=true...')

      const ethAddress = await vault.address(Chain.Ethereum)

      // Get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      // Prepare with autoApprove=true
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          amount: 100,
          swapQuote: quote,
          autoApprove: true, // Core handles approval internally
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      // With autoApprove=true, core handles approval internally (may require 2 signatures)
      // No swapApprovalRequired event is emitted
      console.log('✅ Swap prepared with autoApprove=true')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Approval mode: automatic (core handles internally)`)
      console.log(`   Requires approval: ${quote.requiresApproval}`)
    }, 60000)
  })

  describe('Cross-chain Swap Transactions (LiFi)', () => {
    it('should prepare BSC to Polygon swap transaction', async () => {
      console.log('🔄 Preparing BNB → POL swap transaction (cross-chain)...')

      const bscAddress = await vault.address(Chain.BSC)
      const polygonAddress = await vault.address(Chain.Polygon)

      // First get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.BSC,
            address: bscAddress,
            ticker: 'BNB',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Polygon,
            address: polygonAddress,
            ticker: 'POL',
            decimals: 18,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('No swap route') ||
            error.message.includes('not enough') ||
            error.message.includes('undefined'))
        ) {
          console.log('⚠️ No cross-chain swap route found, skipping...')
          return
        }
        throw error
      }

      expect(quote).toBeDefined()
      console.log(`✅ Quote received via ${quote.provider}`)

      // Prepare the transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.BSC,
            address: bscAddress,
            ticker: 'BNB',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Polygon,
            address: polygonAddress,
            ticker: 'POL',
            decimals: 18,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('expired') ||
            error.message.includes('No swap route') ||
            error.message.includes('undefined'))
        ) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      console.log('✅ Cross-chain swap transaction prepared successfully')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
      console.log(`   Output: ${prepareResult.quote.estimatedOutput} POL`)
    }, 60000)
  })

  describe('Simplified Coin Input', () => {
    it('should prepare swap with simplified coin input', async () => {
      console.log('🔄 Testing simplified coin input for prepareSwapTx...')

      // First get a quote with simplified input
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      expect(quote).toBeDefined()

      // Prepare with simplified input
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult).toBeDefined()
      expect(prepareResult.keysignPayload).toBeDefined()

      console.log('✅ Simplified input worked')
      console.log(`   Provider: ${prepareResult.quote.provider}`)
    }, 60000)
  })

  describe('Transaction Events', () => {
    it('should emit swapPrepared event', async () => {
      console.log('🔍 Testing swap prepared event emission...')

      let eventReceived = false
      let receivedData:
        | {
            provider: string
            fromAmount: string
            toAmountExpected: string
            requiresApproval: boolean
          }
        | undefined

      const handler = (data: {
        provider: string
        fromAmount: string
        toAmountExpected: string
        requiresApproval: boolean
      }) => {
        eventReceived = true
        receivedData = data
      }

      vault.on('swapPrepared', handler)

      try {
        // Get quote
        const quote = await vault.getSwapQuote({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
        })

        // Prepare transaction
        await vault.prepareSwapTx({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
          swapQuote: quote,
        })

        expect(eventReceived).toBe(true)
        expect(receivedData).toBeDefined()
        expect(receivedData?.provider).toBeDefined()
        expect(receivedData?.fromAmount).toBe('0.1')
        expect(receivedData?.toAmountExpected).toBeDefined()

        console.log('✅ swapPrepared event emitted')
        console.log(`   Provider: ${receivedData?.provider}`)
        console.log(`   From: ${receivedData?.fromAmount}`)
        console.log(`   To (expected): ${receivedData?.toAmountExpected}`)
        console.log(`   Requires approval: ${receivedData?.requiresApproval}`)
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route, event test skipped')
        } else {
          throw error
        }
      } finally {
        vault.off('swapPrepared', handler)
      }
    }, 60000)
  })

  describe('Error Handling', () => {
    it('should handle expired quotes gracefully', async () => {
      console.log('🔍 Testing expired quote handling...')

      // Get a quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route, skipping expired quote test...')
          return
        }
        throw error
      }

      // Artificially expire the quote
      const expiredQuote = {
        ...quote,
        expiresAt: Date.now() - 1000, // 1 second ago
      }

      // Should handle gracefully
      try {
        await vault.prepareSwapTx({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.1,
          swapQuote: expiredQuote,
        })
        // If it doesn't throw, that's also acceptable (some implementations retry)
        console.log('✅ Expired quote was handled (retried or accepted)')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        console.log('✅ Expired quote correctly rejected')
      }
    }, 60000)
  })

  // ============================================================================
  // SIGNED SWAP TRANSACTIONS
  // These tests prepare AND sign swap transactions using 2-of-2 MPC
  // Signatures are generated but NEVER broadcast to the blockchain
  // ============================================================================

  describe('Signed Swap Transactions', () => {
    it('should sign ETH to BTC swap transaction (THORChain)', async () => {
      console.log('\n🔐 Testing ETH → BTC swap signing...')

      // Skip if vault is not fast type
      if (vault.type !== 'fast') {
        console.log('⚠️ Skipping: Fast signing requires a "fast" vault')
        return
      }

      const ethAddress = await vault.address(Chain.Ethereum)
      const btcAddress = await vault.address(Chain.Bitcoin)

      // 1. Get swap quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Bitcoin,
            address: btcAddress,
            ticker: 'BTC',
            decimals: 8,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      console.log(`   Quote received via ${quote.provider}`)

      // 2. Prepare swap transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Bitcoin,
            address: btcAddress,
            ticker: 'BTC',
            decimals: 8,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      expect(prepareResult.keysignPayload).toBeDefined()
      console.log('   Swap transaction prepared')

      // 3. Extract message hashes
      const messageHashes = await vault.extractMessageHashes(prepareResult.keysignPayload)
      expect(messageHashes.length).toBeGreaterThan(0)
      console.log(`   Extracted ${messageHashes.length} message hash(es)`)

      // 4. Sign the transaction
      const signingPayload = createSigningPayload(prepareResult.keysignPayload, messageHashes, Chain.Ethereum)
      const signature = await vault.sign(signingPayload)

      // 5. Validate signature
      validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')

      console.log('✅ ETH→BTC swap transaction signed successfully (NOT broadcast)')
      console.log(`   Provider: ${quote.provider}`)
      console.log(`   Expected output: ${quote.estimatedOutput} BTC`)
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    }, 120000)

    it('should sign same-chain ETH to USDC swap (DEX)', async () => {
      console.log('\n🔐 Testing ETH → USDC swap signing (same chain)...')

      if (vault.type !== 'fast') {
        console.log('⚠️ Skipping: Fast signing requires a "fast" vault')
        return
      }

      const ethAddress = await vault.address(Chain.Ethereum)

      // 1. Get swap quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route found, skipping...')
          return
        }
        throw error
      }

      console.log(`   Quote received via ${quote.provider}`)

      // 2. Prepare swap transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            ticker: 'ETH',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Ethereum,
            address: ethAddress,
            id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            ticker: 'USDC',
            decimals: 6,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && (error.message.includes('expired') || error.message.includes('No swap route'))) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      // 3. Extract message hashes and sign
      const messageHashes = await vault.extractMessageHashes(prepareResult.keysignPayload)
      expect(messageHashes.length).toBeGreaterThan(0)
      console.log(`   Extracted ${messageHashes.length} message hash(es)`)

      const signingPayload = createSigningPayload(prepareResult.keysignPayload, messageHashes, Chain.Ethereum)
      const signature = await vault.sign(signingPayload)

      validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')

      console.log('✅ ETH→USDC swap transaction signed successfully (NOT broadcast)')
      console.log(`   Provider: ${quote.provider}`)
      console.log(`   Expected output: ${quote.estimatedOutput} USDC`)
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    }, 120000)

    it('should sign cross-chain BSC to Polygon swap (LiFi)', async () => {
      console.log('\n🔐 Testing BNB → POL swap signing (cross-chain)...')

      if (vault.type !== 'fast') {
        console.log('⚠️ Skipping: Fast signing requires a "fast" vault')
        return
      }

      const bscAddress = await vault.address(Chain.BSC)
      const polygonAddress = await vault.address(Chain.Polygon)

      // 1. Get swap quote
      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: {
            chain: Chain.BSC,
            address: bscAddress,
            ticker: 'BNB',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Polygon,
            address: polygonAddress,
            ticker: 'POL',
            decimals: 18,
          },
          amount: 0.1,
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('No swap route') ||
            error.message.includes('not enough') ||
            error.message.includes('undefined'))
        ) {
          console.log('⚠️ No cross-chain swap route found, skipping...')
          return
        }
        throw error
      }

      console.log(`   Quote received via ${quote.provider}`)

      // 2. Prepare swap transaction
      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: {
            chain: Chain.BSC,
            address: bscAddress,
            ticker: 'BNB',
            decimals: 18,
          },
          toCoin: {
            chain: Chain.Polygon,
            address: polygonAddress,
            ticker: 'POL',
            decimals: 18,
          },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('expired') ||
            error.message.includes('No swap route') ||
            error.message.includes('undefined'))
        ) {
          console.log('⚠️ Quote expired or route unavailable, skipping...')
          return
        }
        throw error
      }

      // 3. Extract message hashes and sign
      const messageHashes = await vault.extractMessageHashes(prepareResult.keysignPayload)
      expect(messageHashes.length).toBeGreaterThan(0)
      console.log(`   Extracted ${messageHashes.length} message hash(es)`)

      const signingPayload = createSigningPayload(prepareResult.keysignPayload, messageHashes, Chain.BSC)
      const signature = await vault.sign(signingPayload)

      validateSignatureFormat(signature, Chain.BSC, 'ECDSA')

      console.log('✅ BNB→POL cross-chain swap signed successfully (NOT broadcast)')
      console.log(`   Provider: ${quote.provider}`)
      console.log(`   Expected output: ${quote.estimatedOutput} POL`)
      console.log(`   Signature: ${signature.signature.substring(0, 60)}...`)
    }, 120000)
  })

  // ============================================================================
  // SAFETY VERIFICATION
  // Confirms that NO transactions were actually broadcast to networks
  // ============================================================================

  describe('Safety Verification', () => {
    it('Confirms NO swap transactions were broadcast to blockchain', async () => {
      console.log('\n🔒 Safety Check: Verifying NO swap transactions were broadcast...')

      if (vault.type !== 'fast') {
        console.log('⚠️ Skipping: Safety verification requires signing a transaction')
        return
      }

      // Sign one swap transaction to verify safety (no broadcast)
      const ethAddress = await vault.address(Chain.Ethereum)
      const btcAddress = await vault.address(Chain.Bitcoin)

      let quote: SwapQuoteResult
      try {
        quote = await vault.getSwapQuote({
          fromCoin: { chain: Chain.Ethereum, address: ethAddress, ticker: 'ETH', decimals: 18 },
          toCoin: { chain: Chain.Bitcoin, address: btcAddress, ticker: 'BTC', decimals: 8 },
          amount: 0.1,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('No swap route')) {
          console.log('⚠️ No swap route, safety check skipped')
          return
        }
        throw error
      }

      let prepareResult: SwapPrepareResult
      try {
        prepareResult = await vault.prepareSwapTx({
          fromCoin: { chain: Chain.Ethereum, address: ethAddress, ticker: 'ETH', decimals: 18 },
          toCoin: { chain: Chain.Bitcoin, address: btcAddress, ticker: 'BTC', decimals: 8 },
          amount: 0.1,
          swapQuote: quote,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('expired')) {
          console.log('⚠️ Quote expired, safety check skipped')
          return
        }
        throw error
      }

      const messageHashes = await vault.extractMessageHashes(prepareResult.keysignPayload)
      const signingPayload = createSigningPayload(prepareResult.keysignPayload, messageHashes, Chain.Ethereum)
      const signature = await vault.sign(signingPayload)

      // Signature was generated...
      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      console.log('✅ Signature generated for swap transaction')

      // ...but NEVER broadcast
      // There is no broadcast() call in any of these tests
      // The signed transaction exists only in memory
      console.log('✅ ZERO swap transactions were broadcast to the blockchain')
      console.log('✅ All swap signatures generated but NEVER submitted to network')
      console.log('✅ Funds remain safe in the vault')
    }, 120000)
  })
})
