/**
 * Unit Tests for formatBalance Adapter
 *
 * Tests the formatBalance function which converts raw bigint balances
 * to SDK Balance format with proper metadata (decimals, symbol).
 */

import { Chain } from '@core/chain/Chain'
import { describe, expect, it } from 'vitest'

import { formatBalance } from '../../../src/adapters/formatBalance'
import { Token } from '../../../src/types'

describe('formatBalance', () => {
  describe('Native Token Balances', () => {
    it('should format Bitcoin native balance correctly', () => {
      const result = formatBalance(100000000n, Chain.Bitcoin)

      expect(result).toEqual({
        amount: '100000000',
        formattedAmount: '1',
        symbol: 'BTC',
        decimals: 8,
        chainId: Chain.Bitcoin,
        tokenId: undefined,
      })
    })

    it('should format Ethereum native balance correctly', () => {
      const result = formatBalance(1000000000000000000n, Chain.Ethereum)

      expect(result).toEqual({
        amount: '1000000000000000000',
        formattedAmount: '1',
        symbol: 'ETH',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: undefined,
      })
    })

    it('should format Solana native balance correctly', () => {
      const result = formatBalance(1000000000n, Chain.Solana)

      expect(result).toEqual({
        amount: '1000000000',
        formattedAmount: '1',
        symbol: 'SOL',
        decimals: 9,
        chainId: Chain.Solana,
        tokenId: undefined,
      })
    })

    it('should format THORChain native balance correctly', () => {
      const result = formatBalance(100000000n, Chain.THORChain)

      expect(result).toEqual({
        amount: '100000000',
        formattedAmount: '1',
        symbol: 'RUNE',
        decimals: 8,
        chainId: Chain.THORChain,
        tokenId: undefined,
      })
    })

    it('should format Ripple native balance correctly', () => {
      const result = formatBalance(1000000n, Chain.Ripple)

      expect(result).toEqual({
        amount: '1000000',
        formattedAmount: '1',
        symbol: 'XRP',
        decimals: 6,
        chainId: Chain.Ripple,
        tokenId: undefined,
      })
    })

    it('should format Polygon native balance correctly', () => {
      const result = formatBalance(1000000000000000000n, Chain.Polygon)

      expect(result).toEqual({
        amount: '1000000000000000000',
        formattedAmount: '1',
        symbol: 'POL',
        decimals: 18,
        chainId: Chain.Polygon,
        tokenId: undefined,
      })
    })

    it('should handle zero balance', () => {
      const result = formatBalance(0n, Chain.Ethereum)

      expect(result).toEqual({
        amount: '0',
        formattedAmount: '0',
        symbol: 'ETH',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: undefined,
      })
    })

    it('should handle very large balances', () => {
      const largeBalance = 999999999999999999999999n
      const result = formatBalance(largeBalance, Chain.Ethereum)

      expect(result.amount).toBe('999999999999999999999999')
      expect(result.formattedAmount).toBe('999999.999999999999999999')
      expect(result.symbol).toBe('ETH')
      expect(result.decimals).toBe(18)
    })
  })

  describe('Token Balances', () => {
    const tokens: Record<string, Token[]> = {
      Ethereum: [
        {
          id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: Chain.Ethereum,
        },
        {
          id: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          symbol: 'USDT',
          name: 'Tether',
          decimals: 6,
          chainId: Chain.Ethereum,
        },
        {
          id: '0x6b175474e89094c44da98b954eedeac495271d0f',
          symbol: 'DAI',
          name: 'Dai',
          decimals: 18,
          chainId: Chain.Ethereum,
        },
      ],
      Polygon: [
        {
          id: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: Chain.Polygon,
        },
      ],
    }

    it('should format USDC token balance with metadata', () => {
      const result = formatBalance(1000000n, Chain.Ethereum, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokens)

      expect(result).toEqual({
        amount: '1000000',
        formattedAmount: '1',
        symbol: 'USDC',
        decimals: 6,
        chainId: Chain.Ethereum,
        tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    })

    it('should format USDT token balance with metadata', () => {
      const result = formatBalance(5000000n, Chain.Ethereum, '0xdac17f958d2ee523a2206206994597c13d831ec7', tokens)

      expect(result).toEqual({
        amount: '5000000',
        formattedAmount: '5',
        symbol: 'USDT',
        decimals: 6,
        chainId: Chain.Ethereum,
        tokenId: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      })
    })

    it('should format DAI token balance with 18 decimals', () => {
      const result = formatBalance(
        1000000000000000000n,
        Chain.Ethereum,
        '0x6b175474e89094c44da98b954eedeac495271d0f',
        tokens
      )

      expect(result).toEqual({
        amount: '1000000000000000000',
        formattedAmount: '1',
        symbol: 'DAI',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: '0x6b175474e89094c44da98b954eedeac495271d0f',
      })
    })

    it('should handle token on different chain (Polygon USDC)', () => {
      const result = formatBalance(2000000n, Chain.Polygon, '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', tokens)

      expect(result).toEqual({
        amount: '2000000',
        formattedAmount: '2',
        symbol: 'USDC',
        decimals: 6,
        chainId: Chain.Polygon,
        tokenId: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
      })
    })

    it('should default to 18 decimals for unknown token', () => {
      const result = formatBalance(1000000000000000000n, Chain.Ethereum, '0xunknowntoken123456789', tokens)

      expect(result).toEqual({
        amount: '1000000000000000000',
        formattedAmount: '1',
        symbol: '0xunknowntoken123456789',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: '0xunknowntoken123456789',
      })
    })

    it('should handle token without token registry', () => {
      const result = formatBalance(
        1000000n,
        Chain.Ethereum,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      )

      expect(result).toEqual({
        amount: '1000000',
        formattedAmount: '0.000000000001',
        symbol: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    })

    it('should handle empty token registry', () => {
      const result = formatBalance(
        1000000n,
        Chain.Ethereum,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        {}
      )

      expect(result).toEqual({
        amount: '1000000',
        formattedAmount: '0.000000000001',
        symbol: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 18,
        chainId: Chain.Ethereum,
        tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    })

    it('should handle zero token balance', () => {
      const result = formatBalance(0n, Chain.Ethereum, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokens)

      expect(result).toEqual({
        amount: '0',
        formattedAmount: '0',
        symbol: 'USDC',
        decimals: 6,
        chainId: Chain.Ethereum,
        tokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    })

    it('should handle very large token balances', () => {
      const largeBalance = 999999999999999999n
      const result = formatBalance(largeBalance, Chain.Ethereum, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokens)

      expect(result.amount).toBe('999999999999999999')
      expect(result.symbol).toBe('USDC')
    })
  })

  describe('Edge Cases', () => {
    it('should handle chain with case sensitivity', () => {
      // Chain names should match exactly
      const result = formatBalance(1000000000000000000n, Chain.Ethereum)
      expect(result.symbol).toBe('ETH')
    })

    it('should preserve tokenId in result', () => {
      const tokenId = '0xcustomtoken'
      const result = formatBalance(100n, Chain.Ethereum, tokenId)

      expect(result.tokenId).toBe(tokenId)
    })

    it('should not include tokenId for native balance', () => {
      const result = formatBalance(100n, Chain.Ethereum)

      expect(result.tokenId).toBeUndefined()
    })

    it('should handle Solana SPL token addresses', () => {
      const splTokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const tokens: Record<string, Token[]> = {
        Solana: [
          {
            id: splTokenAddress,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            chainId: Chain.Solana,
          },
        ],
      }

      const result = formatBalance(1000000n, Chain.Solana, splTokenAddress, tokens)

      expect(result).toEqual({
        amount: '1000000',
        formattedAmount: '1',
        symbol: 'USDC',
        decimals: 6,
        chainId: Chain.Solana,
        tokenId: splTokenAddress,
      })
    })

    it('should handle negative-like values (should not occur but type allows)', () => {
      const result = formatBalance(1n, Chain.Ethereum)
      expect(result.amount).toBe('1')
      expect(result.formattedAmount).toBe('0.000000000000000001')
    })

    it('should format fractional BTC balance correctly', () => {
      const result = formatBalance(30558n, Chain.Bitcoin)
      expect(result.amount).toBe('30558')
      expect(result.formattedAmount).toBe('0.00030558')
    })

    it('should format fractional ETH balance correctly', () => {
      const result = formatBalance(1500000000000000000n, Chain.Ethereum)
      expect(result.amount).toBe('1500000000000000000')
      expect(result.formattedAmount).toBe('1.5')
    })

    it('should format fractional USDC balance correctly', () => {
      const tokens: Record<string, Token[]> = {
        Ethereum: [{ id: '0xusdc', symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: Chain.Ethereum }],
      }
      const result = formatBalance(1234567n, Chain.Ethereum, '0xusdc', tokens)
      expect(result.amount).toBe('1234567')
      expect(result.formattedAmount).toBe('1.234567')
    })
  })

  describe('Type Compatibility', () => {
    it('should return Balance type with all required fields', () => {
      const result = formatBalance(1000000n, Chain.Ethereum)

      expect(result).toHaveProperty('amount')
      expect(result).toHaveProperty('formattedAmount')
      expect(result).toHaveProperty('symbol')
      expect(result).toHaveProperty('decimals')
      expect(result).toHaveProperty('chainId')
      expect(typeof result.amount).toBe('string')
      expect(typeof result.formattedAmount).toBe('string')
      expect(typeof result.symbol).toBe('string')
      expect(typeof result.decimals).toBe('number')
      expect(typeof result.chainId).toBe('string')
    })

    it('should return tokenId when provided', () => {
      const result = formatBalance(1000000n, Chain.Ethereum, '0xtoken')

      expect(result).toHaveProperty('tokenId')
      expect(result.tokenId).toBe('0xtoken')
    })

    it('should return undefined tokenId for native balances', () => {
      const result = formatBalance(1000000n, Chain.Ethereum)

      expect(result.tokenId).toBeUndefined()
    })
  })
})
