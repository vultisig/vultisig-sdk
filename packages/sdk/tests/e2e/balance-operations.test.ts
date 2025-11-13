/**
 * E2E Tests: Balance Operations (Production)
 *
 * These tests use a pre-created persistent fast vault to test real balance
 * fetching operations against production blockchain RPCs. No transactions
 * are broadcast - only read-only operations are performed.
 *
 * Environment: Production (mainnet RPCs)
 * Safety: Read-only operations, no fund transfers
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials MUST be loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - See tests/e2e/SECURITY.md and .env.example for setup instructions
 */

import { loadTestVault, verifyTestVault } from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Vault } from '@/index'

describe('E2E: Balance Operations (Production)', () => {
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

  describe('Single Chain Balance Fetching', () => {
    it('should fetch Bitcoin balance', async () => {
      console.log('🔍 Fetching Bitcoin balance...')

      const balance = await vault.balance('Bitcoin')

      expect(balance).toBeDefined()
      expect(balance.symbol).toBe('BTC')
      expect(balance.decimals).toBe(8)
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Bitcoin')

      // Parse the amount to verify it's a valid number
      const amountNum = parseFloat(balance.amount)
      expect(amountNum).toBeGreaterThanOrEqual(0)

      console.log(`💰 Bitcoin: ${balance.amount} ${balance.symbol}`)
    })

    it('should fetch Ethereum balance', async () => {
      console.log('🔍 Fetching Ethereum balance...')

      const balance = await vault.balance('Ethereum')

      expect(balance).toBeDefined()
      expect(balance.symbol).toBe('ETH')
      expect(balance.decimals).toBe(18)
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Ethereum')

      // Parse the amount to verify it's a valid number
      const amountNum = parseFloat(balance.amount)
      expect(amountNum).toBeGreaterThanOrEqual(0)

      console.log(`💰 Ethereum: ${balance.amount} ${balance.symbol}`)
    })

    it('should fetch Solana balance', async () => {
      console.log('🔍 Fetching Solana balance...')

      const balance = await vault.balance('Solana')

      expect(balance).toBeDefined()
      expect(balance.symbol).toBe('SOL')
      expect(balance.decimals).toBe(9)
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Solana')

      // Parse the amount to verify it's a valid number
      const amountNum = parseFloat(balance.amount)
      expect(amountNum).toBeGreaterThanOrEqual(0)

      console.log(`💰 Solana: ${balance.amount} ${balance.symbol}`)
    })

    it('should fetch Polygon balance', async () => {
      console.log('🔍 Fetching Polygon balance...')

      const balance = await vault.balance('Polygon')

      expect(balance).toBeDefined()
      expect(balance.symbol).toBe('POL') // Polygon rebranded from MATIC to POL in Sept 2024
      expect(balance.decimals).toBe(18)
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Polygon')

      // Parse the amount to verify it's a valid number
      const amountNum = parseFloat(balance.amount)
      expect(amountNum).toBeGreaterThanOrEqual(0)

      console.log(`💰 Polygon: ${balance.amount} ${balance.symbol}`)
    })
  })

  describe('Token Balance Fetching', () => {
    it('should fetch ERC-20 token balance (USDC on Ethereum)', async () => {
      console.log('🔍 Fetching USDC balance on Ethereum...')

      // USDC contract address on Ethereum mainnet
      const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

      const balance = await vault.balance('Ethereum', USDC_ADDRESS)

      expect(balance).toBeDefined()
      expect(balance.symbol).toBeDefined() // Symbol may vary
      expect(balance.decimals).toBeDefined()
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Ethereum')
      expect(balance.tokenId).toBe(USDC_ADDRESS)

      console.log(`💰 USDC: ${balance.amount} ${balance.symbol}`)
    })

    it('should fetch ERC-20 token balance (USDT on Ethereum)', async () => {
      console.log('🔍 Fetching USDT balance on Ethereum...')

      // USDT contract address on Ethereum mainnet
      const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

      const balance = await vault.balance('Ethereum', USDT_ADDRESS)

      expect(balance).toBeDefined()
      expect(balance.symbol).toBeDefined() // Symbol may vary
      expect(balance.decimals).toBeDefined()
      expect(balance.amount).toBeTypeOf('string')
      expect(balance.chainId).toBe('Ethereum')
      expect(balance.tokenId).toBe(USDT_ADDRESS)

      console.log(`💰 USDT: ${balance.amount} ${balance.symbol}`)
    })
  })

  describe('Multi-Chain Balance Fetching', () => {
    it('should fetch balances for multiple chains in parallel', async () => {
      console.log('🔍 Fetching balances for multiple chains...')

      const chains = ['Bitcoin', 'Ethereum', 'Solana', 'Polygon']
      const startTime = Date.now()

      const balances = await vault.balances(chains)
      const fetchTime = Date.now() - startTime

      expect(balances).toBeDefined()
      expect(Object.keys(balances)).toHaveLength(chains.length)

      for (const chain of chains) {
        expect(balances[chain]).toBeDefined()
        expect(balances[chain].symbol).toBeDefined()
        expect(balances[chain].amount).toBeTypeOf('string')
        expect(balances[chain].chainId).toBe(chain)
        console.log(
          `💰 ${chain}: ${balances[chain].amount} ${balances[chain].symbol}`
        )
      }

      console.log(`⚡ Fetched ${chains.length} balances in ${fetchTime}ms`)
    })

    it('should fetch all available chain balances', async () => {
      console.log('🔍 Fetching all chain balances...')

      const balances = await vault.balances()

      expect(balances).toBeDefined()
      const chainCount = Object.keys(balances).length
      expect(chainCount).toBeGreaterThan(0)

      console.log(`💰 Fetched balances for ${chainCount} chains`)

      // Log each balance
      for (const [chain, balance] of Object.entries(balances)) {
        console.log(`  ${chain}: ${balance.amount} ${balance.symbol}`)
      }
    })
  })

  describe('Balance Caching', () => {
    it('should cache balance for repeated fetches', async () => {
      console.log('🔍 Testing balance caching...')

      // First fetch (force fresh by using updateBalance which clears cache)
      const startTime1 = performance.now()
      const balance1 = await vault.updateBalance('Ethereum')
      const fetchTime1 = performance.now() - startTime1

      // Second fetch (cached - should be much faster)
      const startTime2 = performance.now()
      const balance2 = await vault.balance('Ethereum')
      const fetchTime2 = performance.now() - startTime2

      // Cached fetch should be significantly faster (at least 5x)
      // Use a minimum threshold of 1ms to handle sub-millisecond cached responses
      const fetchTime2Adjusted = Math.max(fetchTime2, 0.1) // Avoid division issues
      expect(fetchTime1 / fetchTime2Adjusted).toBeGreaterThan(5)

      // Balances should be identical
      expect(balance1.amount).toBe(balance2.amount)
      expect(balance1.symbol).toBe(balance2.symbol)

      console.log(`⚡ First fetch: ${fetchTime1.toFixed(2)}ms`)
      console.log(`⚡ Cached fetch: ${fetchTime2.toFixed(2)}ms`)
      console.log(
        `🚀 Speedup: ${(fetchTime1 / fetchTime2Adjusted).toFixed(1)}x`
      )
    })

    it('should update balance when explicitly refreshed', async () => {
      console.log('🔍 Testing balance refresh...')

      // Get cached balance
      const balance1 = await vault.balance('Polygon')

      // Force refresh
      const balance2 = await vault.updateBalance('Polygon')

      // Both should be valid balances
      expect(balance1).toBeDefined()
      expect(balance2).toBeDefined()
      expect(balance1.symbol).toBe(balance2.symbol)
      expect(balance1.decimals).toBe(balance2.decimals)

      console.log(`💰 Cached: ${balance1.amount} ${balance1.symbol}`)
      console.log(`💰 Refreshed: ${balance2.amount} ${balance2.symbol}`)
    })
  })

  describe('Address Verification', () => {
    it('should derive valid Bitcoin address', async () => {
      const address = await vault.address('Bitcoin')

      expect(address).toBeDefined()
      expect(address).toMatch(/^bc1/) // Bech32 format

      console.log(`📍 Bitcoin address: ${address}`)
    })

    it('should derive valid Ethereum address', async () => {
      const address = await vault.address('Ethereum')

      expect(address).toBeDefined()
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/) // EVM format

      console.log(`📍 Ethereum address: ${address}`)
    })

    it('should derive same address for all EVM chains', async () => {
      const evmChains = [
        'Ethereum',
        'BSC',
        'Polygon',
        'Avalanche',
        'Arbitrum',
        'Optimism',
        'Base',
      ]

      const addresses = await Promise.all(
        evmChains.map(chain => vault.address(chain))
      )

      // All EVM chains should have the same address
      const uniqueAddresses = new Set(addresses)
      expect(uniqueAddresses.size).toBe(1)

      const sharedAddress = addresses[0]
      expect(sharedAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

      console.log(`📍 Shared EVM address: ${sharedAddress}`)
      console.log(`  Used by: ${evmChains.join(', ')}`)
    })
  })

  describe('Error Handling', () => {
    it('should handle unsupported chain gracefully', async () => {
      await expect(vault.balance('UnsupportedChain' as any)).rejects.toThrow()
    })

    it('should handle invalid token address gracefully', async () => {
      await expect(
        vault.balance('Ethereum', 'invalid_address')
      ).rejects.toThrow()
    })
  })
})
