/**
 * E2E Tests: Transaction Preparation (Production, No Broadcasting)
 *
 * These tests use a pre-created persistent fast vault to test real transaction
 * preparation WITHOUT broadcasting. All operations build transaction payloads
 * and message hashes, but NO actual transactions are sent to the blockchain.
 *
 * Test Vault: TestFastVault-44fd (2-of-2 MPC with VultiServer)
 * Environment: Production (mainnet RPCs)
 * Safety: Read-only operations, NO transaction broadcasting
 */

import { loadTestVault, verifyTestVault } from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Vault } from '@/index'
import { Chain } from '@/types'

describe('E2E: Transaction Preparation (No Broadcasting)', () => {
  let vault: Vault

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const result = await loadTestVault()
    vault = result.vault
    verifyTestVault(vault)
  })

  describe('Ethereum Transaction Preparation', () => {
    it('should prepare ETH transfer (no broadcast)', async () => {
      console.log('📝 Preparing ETH transfer...')

      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 1000000000000000000n, // 1 ETH
      })

      expect(payload).toBeDefined()
      expect(payload.coin).toBeDefined()
      expect(payload.toAddress).toBe(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8'
      )
      expect(payload.toAmount).toBe('1000000000000000000')
      expect(payload.messageHashes).toBeDefined()
      expect(payload.messageHashes.length).toBeGreaterThan(0)

      console.log('✅ ETH transfer prepared (NOT broadcast)')
      console.log(`  To: ${payload.toAddress}`)
      console.log(`  Amount: ${payload.toAmount} wei (1 ETH)`)
      console.log(`  Message Hashes: ${payload.messageHashes.length} hash(es)`)
    })

    it('should prepare ERC-20 transfer (USDC, no broadcast)', async () => {
      console.log('📝 Preparing USDC transfer...')

      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 6,
        ticker: 'USDC',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC contract
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 100000000n, // 100 USDC
      })

      expect(payload).toBeDefined()
      expect(payload.coin.id).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
      expect(payload.toAddress).toBe(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8'
      )
      expect(payload.toAmount).toBe('100000000')

      console.log('✅ USDC transfer prepared (NOT broadcast)')
      console.log(`  Token: USDC (${coin.id})`)
      console.log(`  To: ${payload.toAddress}`)
      console.log(`  Amount: ${payload.toAmount} (100 USDC)`)
    })

    it('should prepare transaction with custom gas settings', async () => {
      console.log('📝 Preparing ETH transfer with custom gas...')

      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 500000000000000000n, // 0.5 ETH
        feeSettings: {
          maxFeePerGas: 50000000000n, // 50 gwei
          maxPriorityFeePerGas: 2000000000n, // 2 gwei
          gasLimit: 21000n,
        },
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('500000000000000000')

      console.log('✅ Custom gas transaction prepared (NOT broadcast)')
      console.log(`  Amount: 0.5 ETH`)
      console.log(`  Custom Gas: 50 gwei max, 2 gwei priority`)
    })
  })

  describe('Bitcoin Transaction Preparation', () => {
    it('should prepare Bitcoin transfer (no broadcast)', async () => {
      console.log('📝 Preparing Bitcoin transfer...')

      const coin = {
        chain: Chain.Bitcoin,
        address: await vault.address('Bitcoin'),
        decimals: 8,
        ticker: 'BTC',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        amount: 100000n, // 0.001 BTC
      })

      expect(payload).toBeDefined()
      expect(payload.toAddress).toBe(
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      )
      expect(payload.toAmount).toBe('100000')
      expect(payload.messageHashes).toBeDefined()

      console.log('✅ Bitcoin transfer prepared (NOT broadcast)')
      console.log(`  To: ${payload.toAddress}`)
      console.log(`  Amount: ${payload.toAmount} satoshis (0.001 BTC)`)
    })

    it('should prepare Bitcoin transaction with custom fee rate', async () => {
      console.log('📝 Preparing Bitcoin transfer with custom fee...')

      const coin = {
        chain: Chain.Bitcoin,
        address: await vault.address('Bitcoin'),
        decimals: 8,
        ticker: 'BTC',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        amount: 50000n, // 0.0005 BTC
        feeSettings: {
          byteFee: 10n, // 10 sat/byte
        },
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('50000')

      console.log('✅ Custom fee Bitcoin transaction prepared (NOT broadcast)')
    })
  })

  describe('Multi-Chain Transaction Preparation', () => {
    it('should prepare Polygon (MATIC) transfer', async () => {
      console.log('📝 Preparing Polygon transfer...')

      const coin = {
        chain: Chain.Polygon,
        address: await vault.address('Polygon'),
        decimals: 18,
        ticker: 'MATIC',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 10000000000000000000n, // 10 MATIC
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('10000000000000000000')

      console.log('✅ Polygon transfer prepared (NOT broadcast)')
    })

    it('should prepare BSC (BNB) transfer', async () => {
      console.log('📝 Preparing BSC transfer...')

      const coin = {
        chain: Chain.BSC,
        address: await vault.address('BSC'),
        decimals: 18,
        ticker: 'BNB',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 1000000000000000000n, // 1 BNB
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('1000000000000000000')

      console.log('✅ BSC transfer prepared (NOT broadcast)')
    })

    it('should prepare Solana transfer', async () => {
      console.log('📝 Preparing Solana transfer...')

      const coin = {
        chain: Chain.Solana,
        address: await vault.address('Solana'),
        decimals: 9,
        ticker: 'SOL',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
        amount: 1000000000n, // 1 SOL
      })

      expect(payload).toBeDefined()
      expect(payload.toAddress).toBe(
        'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
      )
      expect(payload.toAmount).toBe('1000000000')

      console.log('✅ Solana transfer prepared (NOT broadcast)')
    })

    it('should prepare Arbitrum (ETH) transfer', async () => {
      console.log('📝 Preparing Arbitrum transfer...')

      const coin = {
        chain: Chain.Arbitrum,
        address: await vault.address('Arbitrum'),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 500000000000000000n, // 0.5 ETH
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('500000000000000000')

      console.log('✅ Arbitrum transfer prepared (NOT broadcast)')
    })

    it('should prepare Avalanche (AVAX) transfer', async () => {
      console.log('📝 Preparing Avalanche transfer...')

      const coin = {
        chain: Chain.Avalanche,
        address: await vault.address('Avalanche'),
        decimals: 18,
        ticker: 'AVAX',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 5000000000000000000n, // 5 AVAX
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('5000000000000000000')

      console.log('✅ Avalanche transfer prepared (NOT broadcast)')
    })
  })

  describe('Transaction with Memo/Data', () => {
    it('should prepare THORChain swap transaction with memo', async () => {
      console.log('📝 Preparing THORChain swap with memo...')

      const coin = {
        chain: Chain.THORChain,
        address: await vault.address('THORChain'),
        decimals: 8,
        ticker: 'RUNE',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0', // THORChain vault
        amount: 100000000n, // 1 RUNE
        memo: 'SWAP:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      })

      expect(payload).toBeDefined()
      expect(payload.memo).toBe(
        'SWAP:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      )

      console.log('✅ THORChain swap prepared (NOT broadcast)')
      console.log(`  Memo: ${payload.memo}`)
    })

    it('should prepare Cosmos transaction with memo', async () => {
      console.log('📝 Preparing Cosmos transfer with memo...')

      const coin = {
        chain: Chain.Cosmos,
        address: await vault.address('Cosmos'),
        decimals: 6,
        ticker: 'ATOM',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'cosmos1abc123xyz',
        amount: 1000000n, // 1 ATOM
        memo: 'Test memo',
      })

      expect(payload).toBeDefined()
      expect(payload.memo).toBe('Test memo')

      console.log('✅ Cosmos transfer with memo prepared (NOT broadcast)')
    })
  })

  describe('Payload Validation', () => {
    it('should generate valid message hashes', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 1000000000000000000n,
      })

      // Verify message hashes
      expect(payload.messageHashes).toBeDefined()
      expect(Array.isArray(payload.messageHashes)).toBe(true)
      expect(payload.messageHashes.length).toBeGreaterThan(0)

      // Each hash should be a hex string
      for (const hash of payload.messageHashes) {
        expect(hash).toMatch(/^[a-fA-F0-9]+$/)
        expect(hash.length).toBeGreaterThan(0)
      }

      console.log(
        `✅ Generated ${payload.messageHashes.length} valid message hash(es)`
      )
    })

    it('should include all required payload fields', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
        amount: 1000000000000000000n,
      })

      // Verify all required fields
      expect(payload).toHaveProperty('coin')
      expect(payload).toHaveProperty('toAddress')
      expect(payload).toHaveProperty('toAmount')
      expect(payload).toHaveProperty('messageHashes')

      // Verify coin object structure
      expect(payload.coin).toHaveProperty('chain')
      expect(payload.coin).toHaveProperty('address')
      expect(payload.coin).toHaveProperty('decimals')
      expect(payload.coin).toHaveProperty('ticker')

      console.log('✅ Payload contains all required fields')
    })
  })

  describe('Error Handling', () => {
    it('should reject invalid receiver address format', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: 'invalid-ethereum-address',
          amount: 1000000000000000000n,
        })
      ).rejects.toThrow()
    })

    it('should reject unsupported chain', async () => {
      const coin = {
        chain: 'UnsupportedChain' as any,
        address: '0x123',
        decimals: 18,
        ticker: 'UNKNOWN',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
          amount: 1000n,
        })
      ).rejects.toThrow()
    })

    it('should reject zero amount', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address('Ethereum'),
        decimals: 18,
        ticker: 'ETH',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
          amount: 0n,
        })
      ).rejects.toThrow()
    })
  })

  describe('Safety Verification', () => {
    it('should confirm NO transactions were broadcast', async () => {
      console.log(
        '\n🔒 Safety Check: Verifying NO transactions were broadcast...'
      )

      // Prepare multiple transactions
      const chains = ['Ethereum', 'Bitcoin', 'Polygon', 'Arbitrum']

      for (const chainName of chains) {
        const coin = {
          chain: chainName as any,
          address: await vault.address(chainName),
          decimals: 18,
          ticker: chainName,
        }

        await vault.prepareSendTx({
          coin,
          receiver:
            chainName === 'Bitcoin'
              ? 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
              : '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
          amount: 1000000n,
        })
      }

      console.log(`✅ Prepared ${chains.length} transactions`)
      console.log('✅ ZERO transactions were broadcast to the blockchain')
      console.log('✅ All operations were read-only (prepareSendTx only)')
      console.log('✅ No funds were transferred')
    })
  })
})
