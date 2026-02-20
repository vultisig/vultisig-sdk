import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock core modules BEFORE imports
vi.mock('@core/chain/coin/find', () => ({
  findCoins: vi.fn(),
}))

vi.mock('@core/chain/coin/knownTokens', () => ({
  knownTokensIndex: {
    Ethereum: {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
        chain: 'Ethereum',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        ticker: 'USDC',
        decimals: 6,
        logo: 'usdc.png',
        priceProviderId: 'usd-coin',
      },
    },
  },
}))

vi.mock('@core/chain/coin/token/metadata', () => ({
  getTokenMetadata: vi.fn(),
}))

import { Chain } from '@core/chain/Chain'
import { findCoins } from '@core/chain/coin/find'
import { getTokenMetadata } from '@core/chain/coin/token/metadata'

import { TokenDiscoveryService } from '../../../../src/vault/services/TokenDiscoveryService'
import { VaultError, VaultErrorCode } from '../../../../src/vault/VaultError'

describe('TokenDiscoveryService', () => {
  let service: TokenDiscoveryService
  const mockGetAddress = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAddress.mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678')
    service = new TokenDiscoveryService(mockGetAddress)
  })

  describe('discoverTokens', () => {
    it('should discover tokens and map to SDK-owned DiscoveredToken type', async () => {
      vi.mocked(findCoins).mockResolvedValue([
        {
          chain: Chain.Ethereum,
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ticker: 'USDC',
          decimals: 6,
          logo: 'usdc.png',
          balance: 1000000n,
        },
        {
          chain: Chain.Ethereum,
          id: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          ticker: 'USDT',
          decimals: 6,
          logo: 'usdt.png',
          balance: 500000n,
        },
      ] as any)

      const tokens = await service.discoverTokens(Chain.Ethereum)

      expect(tokens).toHaveLength(2)
      expect(tokens[0]).toEqual({
        chain: Chain.Ethereum,
        contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        ticker: 'USDC',
        decimals: 6,
        logo: 'usdc.png',
        balance: '1000000',
      })
    })

    it('should pass the vault address to findCoins', async () => {
      mockGetAddress.mockResolvedValue('0xMyVaultAddress')
      vi.mocked(findCoins).mockResolvedValue([])

      await service.discoverTokens(Chain.Ethereum)

      expect(mockGetAddress).toHaveBeenCalledWith(Chain.Ethereum)
      expect(findCoins).toHaveBeenCalledWith({
        address: '0xMyVaultAddress',
        chain: Chain.Ethereum,
      })
    })

    it('should return empty array when no tokens found', async () => {
      vi.mocked(findCoins).mockResolvedValue([])

      const tokens = await service.discoverTokens(Chain.Ethereum)

      expect(tokens).toEqual([])
    })

    it('should handle tokens without id by using empty string', async () => {
      vi.mocked(findCoins).mockResolvedValue([
        {
          chain: Chain.Ethereum,
          id: undefined,
          ticker: 'UNKNOWN',
          decimals: 18,
        },
      ] as any)

      const tokens = await service.discoverTokens(Chain.Ethereum)

      expect(tokens[0].contractAddress).toBe('')
    })

    it('should throw VaultError with BalanceFetchFailed on discovery failure', async () => {
      vi.mocked(findCoins).mockRejectedValue(new Error('RPC connection failed'))

      await expect(service.discoverTokens(Chain.Ethereum)).rejects.toThrow(VaultError)

      try {
        await service.discoverTokens(Chain.Ethereum)
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.BalanceFetchFailed)
        expect((error as VaultError).message).toContain('Token discovery failed')
        expect((error as VaultError).message).toContain('RPC connection failed')
      }
    })
  })

  describe('resolveToken', () => {
    it('should return token from known tokens registry (fast path)', async () => {
      const token = await service.resolveToken(Chain.Ethereum, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

      expect(token).toEqual({
        chain: Chain.Ethereum,
        contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        ticker: 'USDC',
        decimals: 6,
        logo: 'usdc.png',
        priceProviderId: 'usd-coin',
      })

      // Should NOT call the chain API
      expect(getTokenMetadata).not.toHaveBeenCalled()
    })

    it('should be case-insensitive for known token lookup', async () => {
      const token = await service.resolveToken(Chain.Ethereum, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')

      expect(token).not.toBeNull()
      expect(token.ticker).toBe('USDC')
    })

    it('should fall back to chain API for unknown tokens', async () => {
      vi.mocked(getTokenMetadata).mockResolvedValue({
        ticker: 'PEPE',
        decimals: 18,
        logo: 'pepe.png',
        priceProviderId: 'pepe',
      } as any)

      const token = await service.resolveToken(Chain.Ethereum, '0x6982508145454Ce325dDbE47a25d4ec3d2311933')

      expect(token).toEqual({
        chain: Chain.Ethereum,
        contractAddress: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
        ticker: 'PEPE',
        decimals: 18,
        logo: 'pepe.png',
        priceProviderId: 'pepe',
      })

      expect(getTokenMetadata).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        id: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
      })
    })

    it('should throw VaultError when chain API fails for unknown token', async () => {
      vi.mocked(getTokenMetadata).mockRejectedValue(new Error('Token not found'))

      await expect(service.resolveToken(Chain.Ethereum, '0xdeadbeef')).rejects.toThrow(VaultError)

      try {
        await service.resolveToken(Chain.Ethereum, '0xdeadbeef')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.UnsupportedChain)
        expect((error as VaultError).message).toContain('Cannot resolve token')
      }
    })
  })
})
