import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock core modules BEFORE imports
vi.mock('@vultisig/core-chain/coin/find', () => ({
  findCoins: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/knownTokens', () => ({
  knownTokens: {},
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
    Polygon: {
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': {
        chain: 'Polygon',
        id: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        ticker: 'USDC.e',
        decimals: 6,
        logo: 'usdc.png',
      },
    },
  },
}))

vi.mock('@vultisig/core-chain/coin/token/metadata', () => ({
  getTokenMetadata: vi.fn(),
}))

import { Chain } from '@vultisig/core-chain/Chain'
import { findCoins } from '@vultisig/core-chain/coin/find'
import { getTokenMetadata } from '@vultisig/core-chain/coin/token/metadata'

import type { Token } from '../../../../src/types'
import { TokenDiscoveryService } from '../../../../src/vault/services/TokenDiscoveryService'
import { resolveTokenRef } from '../../../../src/vault/tokenRef'
import { VaultError, VaultErrorCode } from '../../../../src/vault/VaultError'

describe('TokenDiscoveryService', () => {
  let service: TokenDiscoveryService
  let storedTokens: Token[]
  const mockGetAddress = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    storedTokens = []
    mockGetAddress.mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678')
    service = new TokenDiscoveryService(mockGetAddress, () => storedTokens)
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
        tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        ticker: 'USDC',
        decimals: 6,
        logo: 'usdc.png',
      })
    })

    it('uses the Polygon ecosystem ticker and accepts that displayed ticker as input', async () => {
      const contractAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
      vi.mocked(findCoins).mockResolvedValue([
        { chain: Chain.Polygon, id: contractAddress, ticker: 'USDC_1', decimals: 6 },
      ] as any)

      const [discovered] = await service.discoverTokens(Chain.Polygon)
      const storedToken = {
        id: contractAddress.toLowerCase(),
        contractAddress: contractAddress.toLowerCase(),
        symbol: discovered.ticker,
        name: discovered.ticker,
        decimals: discovered.decimals,
        chainId: Chain.Polygon,
        isNative: false,
      }

      expect(discovered.ticker).toBe('USDC.e')
      expect(resolveTokenRef(Chain.Polygon, discovered.ticker, [storedToken])).toMatchObject({
        ticker: 'USDC.e',
        contractAddress: contractAddress.toLowerCase(),
      })
    })

    it('strips an upstream numeric suffix when its base symbol is unique', async () => {
      vi.mocked(findCoins).mockResolvedValue([
        {
          chain: Chain.Ethereum,
          id: '0x00000000000000000000000000000000000000aa',
          ticker: 'WIDGET_7',
          decimals: 18,
        },
      ] as any)

      const [discovered] = await service.discoverTokens(Chain.Ethereum)

      expect(discovered.ticker).toBe('WIDGET')
    })

    it('replaces colliding discovery-order suffixes with address-derived names accepted as input', async () => {
      const firstContract = '0x000000000000000000000000000000001deadbeef'
      const secondContract = '0x000000000000000000000000000000002deadbeef'
      vi.mocked(findCoins).mockResolvedValue([
        { chain: Chain.Ethereum, id: firstContract, ticker: 'WIDGET', decimals: 6 },
        { chain: Chain.Ethereum, id: secondContract, ticker: 'WIDGET_1', decimals: 18 },
      ] as any)

      const discovered = await service.discoverTokens(Chain.Ethereum)
      const stored = discovered.map(token => ({
        id: token.tokenId!,
        contractAddress: token.contractAddress,
        symbol: token.ticker,
        name: token.ticker,
        decimals: token.decimals,
        chainId: Chain.Ethereum,
        isNative: false,
      }))

      expect(discovered.map(token => token.ticker)).toEqual(['WIDGET@1deadbeef', 'WIDGET@2deadbeef'])
      expect(resolveTokenRef(Chain.Ethereum, discovered[0].ticker, stored)).toMatchObject({
        contractAddress: firstContract,
      })
      expect(resolveTokenRef(Chain.Ethereum, discovered[1].ticker, stored)).toMatchObject({
        contractAddress: secondContract,
      })
    })

    it('keeps a discriminator when a newly discovered base symbol is already stored for another contract', async () => {
      const existingContract = '0x00000000000000000000000000000000000000aa'
      const discoveredContract = '0x00000000000000000000000000000000000000bb'
      storedTokens = [
        {
          id: `${Chain.Ethereum}-${existingContract}`,
          contractAddress: existingContract,
          symbol: 'WIDGET',
          name: 'Existing widget',
          decimals: 6,
          chainId: Chain.Ethereum,
          isNative: false,
        },
      ]
      vi.mocked(findCoins).mockResolvedValue([
        { chain: Chain.Ethereum, id: discoveredContract, ticker: 'WIDGET_4', decimals: 18 },
      ] as any)

      const [discovered] = await service.discoverTokens(Chain.Ethereum)
      const newlyStored = {
        id: discovered.contractAddress,
        contractAddress: discovered.contractAddress,
        symbol: discovered.ticker,
        name: discovered.ticker,
        decimals: discovered.decimals,
        chainId: Chain.Ethereum,
        isNative: false,
      }

      expect(discovered.ticker).toBe('WIDGET@000000bb')
      expect(() => resolveTokenRef(Chain.Ethereum, 'WIDGET', [...storedTokens, newlyStored])).toThrow(
        /ambiguous.*contract address/i
      )
      expect(resolveTokenRef(Chain.Ethereum, discovered.ticker, [...storedTokens, newlyStored])).toMatchObject({
        contractAddress: discoveredContract,
      })
    })

    it('preserves case-sensitive Solana mint identities when checking symbol collisions', async () => {
      const firstMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const secondMint = 'ePjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      vi.mocked(findCoins).mockResolvedValue([
        { chain: Chain.Solana, id: firstMint, ticker: 'WIDGET', decimals: 6 },
        { chain: Chain.Solana, id: secondMint, ticker: 'WIDGET_1', decimals: 6 },
      ] as any)

      const discovered = await service.discoverTokens(Chain.Solana)
      const tickers = discovered.map(token => token.ticker)
      const stored = discovered.map(token => ({
        id: token.tokenId!,
        contractAddress: token.contractAddress,
        symbol: token.ticker,
        name: token.ticker,
        decimals: token.decimals,
        chainId: Chain.Solana,
        isNative: false,
      }))

      expect(tickers).toHaveLength(2)
      expect(tickers.every(ticker => /^WIDGET@/u.test(ticker))).toBe(true)
      expect(new Set(tickers.map(ticker => ticker.toUpperCase())).size).toBe(2)
      expect(resolveTokenRef(Chain.Solana, tickers[0], stored).contractAddress).toBe(firstMint)
      expect(resolveTokenRef(Chain.Solana, tickers[1], stored).contractAddress).toBe(secondMint)
      expect(resolveTokenRef(Chain.Solana, secondMint, stored).contractAddress).toBe(secondMint)
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

      expect(tokens[0].tokenId).toBe('')
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
        tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
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
        tokenId: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
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
