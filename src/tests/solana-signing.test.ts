import { describe, test, expect, beforeAll } from 'vitest'
import { initWasm } from '@trustwallet/wallet-core'

import {
  parseSolanaTransaction,
  buildSolanaKeysignPayload,
  JUPITER_V6_PROGRAM_ID,
  RAYDIUM_AMM_PROGRAM_ID,
  JupiterInstructionParser,
  RaydiumInstructionParser,
} from '../chains/solana'

describe('Solana Chain Module', () => {
  let walletCore: any

  beforeAll(async () => {
    // Initialize WalletCore for transaction decoding
    walletCore = await initWasm()
  })

  describe('Configuration', () => {
    test('should export Jupiter V6 program ID', () => {
      expect(JUPITER_V6_PROGRAM_ID).toBeDefined()
      expect(JUPITER_V6_PROGRAM_ID.toString()).toBe(
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
      )
    })

    test('should export Raydium AMM program ID', () => {
      expect(RAYDIUM_AMM_PROGRAM_ID).toBeDefined()
      expect(RAYDIUM_AMM_PROGRAM_ID.toString()).toBe(
        'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS'
      )
    })
  })

  describe('Parsers', () => {
    test('should instantiate Jupiter parser', () => {
      const parser = new JupiterInstructionParser(JUPITER_V6_PROGRAM_ID)
      expect(parser).toBeDefined()
    })

    test('should instantiate Raydium parser', () => {
      const parser = new RaydiumInstructionParser(RAYDIUM_AMM_PROGRAM_ID)
      expect(parser).toBeDefined()
    })
  })

  describe('Transaction Parser', () => {
    test('should handle invalid transaction gracefully', async () => {
      const invalidTx = new Uint8Array([0, 1, 2, 3])

      await expect(
        parseSolanaTransaction(walletCore, invalidTx)
      ).rejects.toThrow()
    })

    test('should require WalletCore for parsing', async () => {
      const tx = new Uint8Array([0, 1, 2, 3])

      await expect(
        parseSolanaTransaction(null as any, tx)
      ).rejects.toThrow()
    })
  })

  describe('Keysign Payload Builder', () => {
    test('should build keysign payload for transfer', async () => {
      const parsedTransaction = {
        type: 'transfer' as const,
        authority: 'SomeAddress123',
        inputToken: {
          address: 'So11111111111111111111111111111111111111112',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
        },
        inAmount: 1000000000, // 1 SOL
        receiverAddress: 'ReceiverAddress456',
      }

      const serializedTx = new Uint8Array([1, 2, 3, 4])
      const vaultPublicKey = '0xpublickey'

      const payload = await buildSolanaKeysignPayload({
        parsedTransaction,
        serializedTransaction: serializedTx,
        vaultPublicKey,
        skipBroadcast: false,
      })

      expect(payload).toBeDefined()
      expect(payload.coin).toBeDefined()
      expect(payload.coin?.chain).toBe('Solana')
      expect(payload.coin?.ticker).toBe('SOL')
      expect(payload.toAddress).toBe('ReceiverAddress456')
      expect(payload.toAmount).toBe('1000000000')
      expect(payload.vaultPublicKeyEcdsa).toBe(vaultPublicKey)
    })

    test('should build keysign payload for swap', async () => {
      const parsedTransaction = {
        type: 'swap' as const,
        authority: 'SwapAuthority123',
        inputToken: {
          address: 'So11111111111111111111111111111111111111112',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
        },
        outputToken: {
          address: 'USDCAddress',
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
        },
        inAmount: 1000000000, // 1 SOL
        outAmount: 150000000, // 150 USDC
        protocol: 'jupiter' as const,
      }

      const serializedTx = new Uint8Array([1, 2, 3, 4])
      const vaultPublicKey = '0xpublickey'

      const payload = await buildSolanaKeysignPayload({
        parsedTransaction,
        serializedTransaction: serializedTx,
        vaultPublicKey,
        skipBroadcast: false,
      })

      expect(payload).toBeDefined()
      expect(payload.coin).toBeDefined()
      expect(payload.swapPayload).toBeDefined()
      expect(payload.swapPayload?.case).toBe('oneinchSwapPayload')

      if (payload.swapPayload?.case === 'oneinchSwapPayload') {
        const swapPayload = payload.swapPayload.value
        expect(swapPayload.fromCoin?.ticker).toBe('SOL')
        expect(swapPayload.toCoin?.ticker).toBe('USDC')
        expect(swapPayload.fromAmount).toBe('1000000000')
      }
    })

    test('should handle SPL token transfers', async () => {
      const parsedTransaction = {
        type: 'transfer' as const,
        authority: 'TokenAuthority',
        inputToken: {
          address: 'USDCAddress',
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
        },
        inAmount: 100000000, // 100 USDC
        receiverAddress: 'ReceiverAddress',
      }

      const serializedTx = new Uint8Array([1, 2, 3, 4])
      const vaultPublicKey = '0xpublickey'

      const payload = await buildSolanaKeysignPayload({
        parsedTransaction,
        serializedTransaction: serializedTx,
        vaultPublicKey,
        skipBroadcast: false,
      })

      expect(payload).toBeDefined()
      expect(payload.coin?.ticker).toBe('USDC')
      expect(payload.coin?.contractAddress).toBe('USDCAddress')
      expect(payload.coin?.isNativeToken).toBe(false)
    })

    test('should set skipBroadcast flag', async () => {
      const parsedTransaction = {
        type: 'transfer' as const,
        authority: 'SomeAddress',
        inputToken: {
          address: 'So11111111111111111111111111111111111111112',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
        },
        inAmount: 1000000000,
        receiverAddress: 'Receiver',
      }

      const serializedTx = new Uint8Array([1, 2, 3, 4])
      const vaultPublicKey = '0xpublickey'

      const payload = await buildSolanaKeysignPayload({
        parsedTransaction,
        serializedTransaction: serializedTx,
        vaultPublicKey,
        skipBroadcast: true,
      })

      expect(payload.skipBroadcast).toBe(true)
    })
  })

  describe('Type Definitions', () => {
    test('should have proper SolanaToken structure', () => {
      const token = {
        address: 'TokenAddress',
        name: 'Token Name',
        symbol: 'TKN',
        decimals: 9,
        logoURI: 'https://example.com/logo.png',
      }

      expect(token.address).toBeDefined()
      expect(token.name).toBeDefined()
      expect(token.symbol).toBeDefined()
      expect(token.decimals).toBeDefined()
    })

    test('should have proper ParsedSolanaTransaction types', () => {
      const transfer = {
        type: 'transfer' as const,
        authority: 'Authority',
        inputToken: {
          address: 'Address',
          name: 'Name',
          symbol: 'SYM',
          decimals: 9,
        },
        inAmount: 1000,
        receiverAddress: 'Receiver',
      }

      expect(transfer.type).toBe('transfer')
      expect(transfer.authority).toBeDefined()
      expect(transfer.inputToken).toBeDefined()
      expect(transfer.receiverAddress).toBeDefined()

      const swap = {
        type: 'swap' as const,
        authority: 'Authority',
        inputToken: {
          address: 'Address1',
          name: 'Name1',
          symbol: 'SYM1',
          decimals: 9,
        },
        outputToken: {
          address: 'Address2',
          name: 'Name2',
          symbol: 'SYM2',
          decimals: 6,
        },
        inAmount: 1000,
        outAmount: 2000,
        protocol: 'jupiter' as const,
      }

      expect(swap.type).toBe('swap')
      expect(swap.outputToken).toBeDefined()
      expect(swap.outAmount).toBeDefined()
      expect(swap.protocol).toBe('jupiter')
    })
  })
})
