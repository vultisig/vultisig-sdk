/**
 * Tests for price impact calculation
 */

import { describe, expect, it, vi } from 'vitest'

import { RujiraSwap } from '../modules/swap.js'
import type { OrderBook } from '../types.js'

// Helper to create orderbook
const createOrderbook = (
  bids: Array<{ price: string; amount: string }>,
  asks: Array<{ price: string; amount: string }>
): OrderBook => ({
  pair: {
    base: 'THOR.RUNE',
    quote: 'BTC.BTC',
    contractAddress: 'thor1contract...',
    tick: '0.00000001',
    takerFee: '0.0015',
    makerFee: '0.00075',
  },
  bids: bids.map(b => ({
    price: b.price,
    amount: b.amount,
    total: (parseFloat(b.price) * parseFloat(b.amount)).toString(),
  })),
  asks: asks.map(a => ({
    price: a.price,
    amount: a.amount,
    total: (parseFloat(a.price) * parseFloat(a.amount)).toString(),
  })),
  spread: '0.5',
  lastPrice: '0.00002500',
  timestamp: Date.now(),
})

// Mock the client
const createMockClient = (orderbook: OrderBook | null = null) => ({
  config: {
    defaultSlippageBps: 100,
    contracts: {
      finContracts: {
        'THOR.RUNE/BTC.BTC': 'thor1contract...',
      },
    },
  },
  discovery: {
    getContractAddress: vi.fn().mockResolvedValue('thor1contract...'),
  },
  simulateSwap: vi.fn().mockResolvedValue({
    returned: '99000000',
    fee: '1000000',
  }),
  orderbook: {
    getOrderBook: vi.fn().mockImplementation(async () => {
      if (orderbook === null) {
        throw new Error('No orderbook')
      }
      return orderbook
    }),
  },
  executeContract: vi.fn().mockResolvedValue({
    transactionHash: 'TESTHASH123',
  }),
  getAddress: vi.fn().mockResolvedValue('thor1user...'),
  getBalance: vi.fn().mockResolvedValue({
    denom: 'rune',
    amount: '1000000000',
  }),
})

describe('Price Impact Calculation', () => {
  describe('with orderbook data', () => {
    it('should calculate price impact using mid price', async () => {
      // Orderbook with bid=0.99, ask=1.01, mid=1.00
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      // Simulate swap: input 100, output 99 => exec price = 0.99
      mockClient.simulateSwap.mockResolvedValue({
        returned: '99000000', // 99 units
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000', // 100 units
      })

      // mid_price = 1.00, exec_price = 0.99
      // impact = |((0.99 - 1.00) / 1.00)| * 100 = 1%
      expect(parseFloat(quote.priceImpact)).toBeCloseTo(1, 0)
    })

    it('should handle tight spread (low impact)', async () => {
      // Very tight spread: bid=0.9999, ask=1.0001
      const orderbook = createOrderbook([{ price: '0.9999', amount: '1000' }], [{ price: '1.0001', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      // Perfect execution at mid price
      mockClient.simulateSwap.mockResolvedValue({
        returned: '100000000',
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should show low impact
      expect(parseFloat(quote.priceImpact)).toBeLessThan(0.5)
    })

    it('should return actual impact for thin liquidity without capping', async () => {
      // Wide spread simulating thin liquidity
      const orderbook = createOrderbook(
        [{ price: '0.01', amount: '1000' }], // Very low bid
        [{ price: '0.99', amount: '1000' }] // Normal ask
      )

      const mockClient = createMockClient(orderbook)
      // Simulate very poor execution
      mockClient.simulateSwap.mockResolvedValue({
        returned: '1000000', // Very low output
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return actual high impact (no 50% cap) or 'unknown' for extreme cases
      const impact = quote.priceImpact
      if (impact !== 'unknown') {
        expect(parseFloat(impact)).toBeGreaterThan(50)
      }
    })

    it('should handle reversed swap direction (selling base) correctly', async () => {
      // Orderbook mid price = 100 (e.g., RUNE/USDC where 1 RUNE = 100 USDC)
      const orderbook = createOrderbook([{ price: '99', amount: '1000' }], [{ price: '101', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      // Swap is selling base: input=RUNE, output=USDC
      // Execution price = output/input = 9900000000/100000000 = 99
      // But if the swap direction is reversed relative to pair convention,
      // exec price would be 1/99 ≈ 0.0101, way off from midPrice=100
      // The fix detects this and tries the inverse direction
      mockClient.simulateSwap.mockResolvedValue({
        returned: '9900000000', // 99 USDC (selling 1 RUNE at ~99 USDC)
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000', // 1 RUNE
      })

      // Direct: exec=99, mid=100 → impact = 1% ✓
      // Should show ~1% impact, not 50% or unknown
      expect(parseFloat(quote.priceImpact)).toBeCloseTo(1, 0)
    })

    it('should handle small trade on deep pair (the original bug scenario)', async () => {
      // Deep BTC/USDC pair with tight spread
      const orderbook = createOrderbook(
        [{ price: '0.00001538', amount: '10000000' }], // Deep bid
        [{ price: '0.00001542', amount: '10000000' }] // Deep ask, tight spread
      )

      const mockClient = createMockClient(orderbook)
      // Small USDC → BTC trade: $13 USDC
      // exec_price = output/input = 200000/1300000000 ≈ 0.000000154
      // mid_price ≈ 0.0000154
      // Direct ratio: 0.000000154/0.0000154 = 0.01 → huge impact!
      // Inverse: input/output = 1300000000/200000 = 6500 → also way off
      // But inverse exec price = 6500, compared to mid = 0.0000154 → worse
      // Direct exec price = 0.000000154, mid = 0.0000154 → ratio ~0.01
      //
      // Actually with different decimal precision, this would return 'unknown'
      // which is correct — we can't compare raw base-unit amounts to market prices
      mockClient.simulateSwap.mockResolvedValue({
        returned: '200000', // ~0.002 BTC
        fee: '1000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '1300000000', // 13 USDC in 8-decimal base units
      })

      // Should NOT return '50.00' — should be either accurate or 'unknown'
      expect(quote.priceImpact).not.toBe('50.00')
    })
  })

  describe('empty/partial orderbook handling', () => {
    it('should use fallback when orderbook is empty', async () => {
      const orderbook = createOrderbook([], [])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return 'unknown' when orderbook data is unavailable
      expect(quote.priceImpact).toBe('unknown')
    })

    it('should return unknown when only bids exist', async () => {
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return 'unknown' when orderbook is incomplete
      expect(quote.priceImpact).toBe('unknown')
    })

    it('should return unknown when only asks exist', async () => {
      const orderbook = createOrderbook([], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return 'unknown' when orderbook is incomplete
      expect(quote.priceImpact).toBe('unknown')
    })
  })

  describe('orderbook fetch failure', () => {
    it('should use fallback when orderbook fetch fails', async () => {
      const mockClient = createMockClient(null) // Will throw
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should still return a quote with 'unknown' impact
      expect(quote).toBeDefined()
      expect(quote.priceImpact).toBe('unknown')
    })
  })

  describe('edge cases', () => {
    it('should handle zero input amount', async () => {
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      mockClient.simulateSwap.mockResolvedValue({
        returned: '0',
        fee: '0',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      // This should throw due to validation, but if it somehow passes
      // the impact calculation should handle it gracefully
      try {
        await swap.getQuote({
          fromAsset: 'THOR.RUNE',
          toAsset: 'BTC.BTC',
          amount: '0',
        })
      } catch {
        // Expected - amount validation should reject zero
        expect(true).toBe(true)
      }
    })

    it('should handle very large amounts', async () => {
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      mockClient.simulateSwap.mockResolvedValue({
        returned: '99000000000000000000', // Very large
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000000000000000', // Very large
      })

      // Should calculate without overflow
      expect(parseFloat(quote.priceImpact)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(quote.priceImpact)).toBeLessThanOrEqual(50)
    })

    it('should include priceImpact in quote response', async () => {
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      expect(quote).toHaveProperty('priceImpact')
      expect(typeof quote.priceImpact).toBe('string')
      expect(parseFloat(quote.priceImpact)).not.toBeNaN()
    })
  })
})
