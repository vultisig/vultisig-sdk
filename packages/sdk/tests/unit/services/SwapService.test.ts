import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock core functions - must be before imports
// Mock findSwapQuote module
vi.mock('@core/chain/swap/quote/findSwapQuote', () => ({
  findSwapQuote: vi.fn(),
}))

// Mock buildSwapKeysignPayload module
vi.mock('@core/mpc/keysign/swap/build', () => ({
  buildSwapKeysignPayload: vi.fn(),
}))

// Mock getErc20Allowance module
vi.mock('@core/chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: vi.fn(),
}))

// Mock isChainOfKind to always work
vi.mock('@core/chain/ChainKind', () => ({
  isChainOfKind: vi.fn((chain: string, kind: string) => {
    const evmChains = ['Ethereum', 'BSC', 'Polygon', 'Avalanche', 'Base', 'Arbitrum', 'Optimism']
    if (kind === 'evm') return evmChains.includes(chain)
    return false
  }),
}))

// Mock swapEnabledChains
vi.mock('@core/chain/swap/swapEnabledChains', () => ({
  swapEnabledChains: [
    'Ethereum',
    'Bitcoin',
    'Avalanche',
    'BSC',
    'Polygon',
    'THORChain',
    'MayaChain',
    'Arbitrum',
    'Base',
    'Solana',
  ] as const,
}))

// Mock chainFeeCoin
vi.mock('@core/chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: {
    Ethereum: { ticker: 'ETH', decimals: 18 },
    Bitcoin: { ticker: 'BTC', decimals: 8 },
    BSC: { ticker: 'BNB', decimals: 18 },
    Polygon: { ticker: 'MATIC', decimals: 18 },
    THORChain: { ticker: 'RUNE', decimals: 8 },
    MayaChain: { ticker: 'CACAO', decimals: 10 },
    Avalanche: { ticker: 'AVAX', decimals: 18 },
    Base: { ticker: 'ETH', decimals: 18 },
    Arbitrum: { ticker: 'ETH', decimals: 18 },
    Solana: { ticker: 'SOL', decimals: 9 },
    Cosmos: { ticker: 'ATOM', decimals: 6 },
  },
}))

// Mock getPublicKey
vi.mock('@core/chain/publicKey/getPublicKey', () => ({
  getPublicKey: vi.fn(() => ({
    data: vi.fn().mockReturnValue(new Uint8Array(33)),
  })),
}))

import type { Vault as CoreVault } from '@core/mpc/vault/Vault'

import type { WasmProvider } from '../../../src/context/SdkContext'
import type { VaultEvents } from '../../../src/events/types'
import { SwapService } from '../../../src/vault/services/SwapService'
import type { SwapQuoteResult } from '../../../src/vault/swap-types'

describe('SwapService', () => {
  let service: SwapService
  let mockVaultData: CoreVault
  let mockGetAddress: (chain: Chain) => Promise<string>
  let mockEmitEvent: <K extends keyof VaultEvents>(event: K, data: VaultEvents[K]) => void
  let mockWasmProvider: WasmProvider
  let emittedEvents: Array<{ event: string; data: unknown }>

  beforeEach(() => {
    vi.clearAllMocks()

    emittedEvents = []

    mockVaultData = {
      name: 'Test Vault',
      publicKeys: {
        ecdsa: 'mock-ecdsa-pubkey',
        eddsa: 'mock-eddsa-pubkey',
      },
      hexChainCode: 'mock-chain-code',
      signers: ['local-party-1'],
      localPartyId: 'local-party-1',
      createdAt: Date.now(),
      libType: 'DKLS',
      isBackedUp: true,
      order: 0,
      keyShares: { ecdsa: '', eddsa: '' },
    }

    mockGetAddress = vi.fn().mockImplementation(async (chain: Chain) => {
      if (chain === Chain.Ethereum) return '0x1234567890abcdef1234567890abcdef12345678'
      if (chain === Chain.Bitcoin) return 'bc1qxxx...'
      return `address-for-${chain}`
    })

    mockEmitEvent = vi.fn((event, data) => {
      emittedEvents.push({ event, data })
    })

    // Create mock WasmProvider
    mockWasmProvider = {
      getWalletCore: vi.fn().mockResolvedValue({
        PublicKey: {
          createWithData: vi.fn(),
        },
      }),
      initializeDkls: vi.fn().mockResolvedValue(undefined),
      initializeSchnorr: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ walletCore: true, dkls: true, schnorr: true }),
    }

    service = new SwapService(mockVaultData, mockGetAddress, mockEmitEvent, mockWasmProvider)
  })

  describe('getQuote', () => {
    it('should fetch a swap quote for native tokens', async () => {
      const { findSwapQuote } = await import('@core/chain/swap/quote/findSwapQuote')

      const mockQuote = {
        native: {
          swapChain: 'THORChain' as const,
          expected_amount_out: '1000000000',
          expiry: Math.floor(Date.now() / 1000) + 600,
          fees: {
            affiliate: '0',
            asset: 'ETH',
            outbound: '100000',
            total: '100000',
          },
          inbound_address: '0x...',
          memo: '=:ETH.ETH:0x...',
          notes: '',
          outbound_delay_blocks: 0,
          outbound_delay_seconds: 0,
          recommended_min_amount_in: '1000000',
          warning: '',
        },
      }

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote as any)

      const result = await service.getQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          ticker: 'ETH',
          decimals: 18,
        },
        toCoin: {
          chain: Chain.Bitcoin,
          address: 'bc1qxxx...',
          ticker: 'BTC',
          decimals: 8,
        },
        amount: 1.0,
      })

      expect(result).toBeDefined()
      expect(result.provider).toBe('thorchain')
      expect(result.estimatedOutput).toBeDefined()
      expect(result.requiresApproval).toBe(false)
      expect(result.quote).toEqual(mockQuote)

      // Should emit swapQuoteReceived event
      expect(mockEmitEvent).toHaveBeenCalledWith('swapQuoteReceived', {
        quote: expect.any(Object),
      })
    })

    it('should fetch a swap quote for ERC-20 token requiring approval', async () => {
      const { findSwapQuote } = await import('@core/chain/swap/quote/findSwapQuote')
      const { getErc20Allowance } = await import('@core/chain/chains/evm/erc20/getErc20Allowance')

      const mockQuote = {
        general: {
          dstAmount: '1000000000',
          provider: '1inch' as const,
          tx: {
            evm: {
              from: '0x1234...',
              to: '0x1111111254fb6c44bAC0beD2854e76F90643097d', // 1inch router
              data: '0x...',
              value: '0',
              gasLimit: 300000n,
            },
          },
        },
      }

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote)
      vi.mocked(getErc20Allowance).mockResolvedValue(0n) // No allowance

      const result = await service.getQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          ticker: 'USDC',
          decimals: 6,
        },
        toCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 100,
      })

      expect(result).toBeDefined()
      expect(result.provider).toBe('1inch')
      expect(result.requiresApproval).toBe(true)
      expect(result.approvalInfo).toBeDefined()
      expect(result.approvalInfo?.spender).toBe('0x1111111254fb6c44bAC0beD2854e76F90643097d')
    })

    it('should not require approval when allowance is sufficient', async () => {
      const { findSwapQuote } = await import('@core/chain/swap/quote/findSwapQuote')
      const { getErc20Allowance } = await import('@core/chain/chains/evm/erc20/getErc20Allowance')

      const mockQuote = {
        general: {
          dstAmount: '1000000000000000000',
          provider: '1inch' as const,
          tx: {
            evm: {
              from: '0x1234...',
              to: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
              data: '0x...',
              value: '0',
            },
          },
        },
      }

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote)
      // Sufficient allowance (100 USDC with 6 decimals = 100000000)
      vi.mocked(getErc20Allowance).mockResolvedValue(200000000n)

      const result = await service.getQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ticker: 'USDC',
          decimals: 6,
        },
        toCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 100,
      })

      expect(result.requiresApproval).toBe(false)
      expect(result.approvalInfo).toBeUndefined()
    })

    it('should resolve simplified coin input', async () => {
      const { findSwapQuote } = await import('@core/chain/swap/quote/findSwapQuote')

      const mockQuote = {
        native: {
          swapChain: 'THORChain' as const,
          expected_amount_out: '500000000',
          expiry: Math.floor(Date.now() / 1000) + 600,
          fees: {
            affiliate: '0',
            asset: 'BTC',
            outbound: '50000',
            total: '50000',
          },
          memo: '=:BTC.BTC:bc1q...',
          notes: '',
          outbound_delay_blocks: 0,
          outbound_delay_seconds: 0,
          recommended_min_amount_in: '100000',
          warning: '',
        },
      }

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote as any)

      // Use simplified input format
      const result = await service.getQuote({
        fromCoin: { chain: Chain.Ethereum },
        toCoin: { chain: Chain.Bitcoin },
        amount: 1.0,
      })

      expect(result).toBeDefined()
      expect(findSwapQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.objectContaining({
            chain: Chain.Ethereum,
            ticker: 'ETH',
            decimals: 18,
          }),
          to: expect.objectContaining({
            chain: Chain.Bitcoin,
            ticker: 'BTC',
            decimals: 8,
          }),
        })
      )
    })

    it('should handle quote errors gracefully', async () => {
      const { findSwapQuote } = await import('@core/chain/swap/quote/findSwapQuote')

      vi.mocked(findSwapQuote).mockRejectedValue(new Error('No swap routes found'))

      await expect(
        service.getQuote({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.001,
        })
      ).rejects.toThrow('No swap route found')

      // Should emit error event
      expect(mockEmitEvent).toHaveBeenCalledWith('error', expect.any(Error))
    })
  })

  describe('prepareSwapTx', () => {
    it('should prepare swap transaction', async () => {
      const { buildSwapKeysignPayload } = await import('@core/mpc/keysign/swap/build')

      const mockKeysignPayload = {
        coin: {},
        toAmount: '1000000000',
        toAddress: '0x...',
        vaultLocalPartyId: 'local-party-1',
        vaultPublicKeyEcdsa: 'mock-ecdsa-pubkey',
        swapPayload: {
          case: 'oneinchSwapPayload',
          value: {},
        },
        blockchainSpecific: {
          case: 'ethereumSpecific',
          value: {},
        },
      }

      vi.mocked(buildSwapKeysignPayload).mockResolvedValue(mockKeysignPayload as any)

      const mockQuoteResult: SwapQuoteResult = {
        quote: {
          general: {
            dstAmount: '1000000000',
            provider: '1inch',
            tx: {
              evm: {
                from: '0x...',
                to: '0x...',
                data: '0x...',
                value: '0',
              },
            },
          },
        },
        estimatedOutput: '1.0',
        provider: '1inch',
        expiresAt: Date.now() + 60000,
        requiresApproval: false,
        fees: { network: '0', total: '0' },
        warnings: [],
      }

      const result = await service.prepareSwapTx({
        fromCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          ticker: 'ETH',
          decimals: 18,
        },
        toCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ticker: 'USDC',
          decimals: 6,
        },
        amount: 1.0,
        swapQuote: mockQuoteResult,
      })

      expect(result).toBeDefined()
      expect(result.keysignPayload).toBeDefined()
      expect(result.quote).toEqual(mockQuoteResult)

      // Should emit swapPrepared event
      expect(mockEmitEvent).toHaveBeenCalledWith('swapPrepared', {
        provider: '1inch',
        fromAmount: '1',
        toAmountExpected: '1.0',
        requiresApproval: false,
      })
    })

    it('should reject expired quotes', async () => {
      const expiredQuote: SwapQuoteResult = {
        quote: {
          native: {
            swapChain: 'THORChain',
            expected_amount_out: '1000000000',
            expiry: Math.floor(Date.now() / 1000) - 100,
            fees: { affiliate: '0', asset: '', outbound: '0', total: '0' },
            memo: '',
            notes: '',
            outbound_delay_blocks: 0,
            outbound_delay_seconds: 0,
            recommended_min_amount_in: '0',
            warning: '',
          },
        },
        estimatedOutput: '1.0',
        provider: 'thorchain',
        expiresAt: Date.now() - 10000, // Expired
        requiresApproval: false,
        fees: { network: '0', total: '0' },
        warnings: [],
      }

      await expect(
        service.prepareSwapTx({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 1.0,
          swapQuote: expiredQuote,
        })
      ).rejects.toThrow('expired')
    })

    it('should emit swapApprovalRequired when approval needed', async () => {
      const { buildSwapKeysignPayload } = await import('@core/mpc/keysign/swap/build')

      const mockKeysignPayload = {
        coin: {},
        toAmount: '100000000',
        toAddress: '0x...',
        vaultLocalPartyId: 'local-party-1',
        vaultPublicKeyEcdsa: 'mock-ecdsa-pubkey',
        swapPayload: {
          case: 'oneinchSwapPayload',
          value: {},
        },
        blockchainSpecific: {
          case: 'ethereumSpecific',
          value: {},
        },
        erc20ApprovePayload: {
          amount: '100000000',
          spender: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        },
      }

      vi.mocked(buildSwapKeysignPayload).mockResolvedValue(mockKeysignPayload as any)

      const mockQuoteResult: SwapQuoteResult = {
        quote: {
          general: {
            dstAmount: '1000000000000000000',
            provider: '1inch',
            tx: {
              evm: {
                from: '0x...',
                to: '0x...',
                data: '0x...',
                value: '0',
              },
            },
          },
        },
        estimatedOutput: '1.0',
        provider: '1inch',
        expiresAt: Date.now() + 60000,
        requiresApproval: true,
        approvalInfo: {
          spender: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
          currentAllowance: 0n,
          requiredAmount: 100000000n,
        },
        fees: { network: '0', total: '0' },
        warnings: [],
      }

      await service.prepareSwapTx({
        fromCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ticker: 'USDC',
          decimals: 6,
        },
        toCoin: {
          chain: Chain.Ethereum,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 100,
        swapQuote: mockQuoteResult,
        autoApprove: false,
      })

      // Should emit swapApprovalRequired event
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'swapApprovalRequired',
        expect.objectContaining({
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          spender: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
        })
      )
    })
  })

  describe('isSwapSupported', () => {
    it('should return true for supported chain pairs', () => {
      expect(service.isSwapSupported(Chain.Ethereum, Chain.Bitcoin)).toBe(true)
      expect(service.isSwapSupported(Chain.Ethereum, Chain.Ethereum)).toBe(true)
      expect(service.isSwapSupported(Chain.BSC, Chain.Polygon)).toBe(true)
    })

    it('should return false for unsupported chains', () => {
      // Assuming some chains are not in the mock swapEnabledChains
      expect(service.isSwapSupported(Chain.Cosmos, Chain.Ethereum)).toBe(false)
    })
  })

  describe('getSupportedChains', () => {
    it('should return list of supported chains', () => {
      const chains = service.getSupportedChains()
      expect(chains).toContain('Ethereum')
      expect(chains).toContain('Bitcoin')
      expect(chains).toContain('THORChain')
    })
  })

  describe('getAllowance', () => {
    it('should return 0 for native tokens', async () => {
      const allowance = await service.getAllowance(
        {
          chain: Chain.Ethereum,
          address: '0x...',
          ticker: 'ETH',
          decimals: 18,
        },
        '0x...'
      )

      expect(allowance).toBe(0n)
    })

    it('should fetch allowance for ERC-20 tokens', async () => {
      const { getErc20Allowance } = await import('@core/chain/chains/evm/erc20/getErc20Allowance')

      vi.mocked(getErc20Allowance).mockResolvedValue(1000000n)

      const allowance = await service.getAllowance(
        {
          chain: Chain.Ethereum,
          address: '0x1234...',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ticker: 'USDC',
          decimals: 6,
        },
        '0x1111111254fb6c44bAC0beD2854e76F90643097d'
      )

      expect(allowance).toBe(1000000n)
      expect(getErc20Allowance).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        address: '0x1234...',
        spender: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
      })
    })
  })
})
