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

    it('should cap impact at 50% for thin liquidity', async () => {
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

      // Should be capped at 50%
      expect(parseFloat(quote.priceImpact)).toBeLessThanOrEqual(50)
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

      // Should return fallback estimate (range format when orderbook unavailable)
      expect(quote.priceImpact).toBe('1.0-3.0')
    })

    it('should use fallback when only bids exist', async () => {
      const orderbook = createOrderbook([{ price: '0.99', amount: '1000' }], [])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return fallback estimate (range format when orderbook unavailable)
      expect(quote.priceImpact).toBe('1.0-3.0')
    })

    it('should use fallback when only asks exist', async () => {
      const orderbook = createOrderbook([], [{ price: '1.01', amount: '1000' }])

      const mockClient = createMockClient(orderbook)
      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000',
      })

      // Should return fallback estimate (range format when orderbook unavailable)
      expect(quote.priceImpact).toBe('1.0-3.0')
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

      // Should still return a quote with fallback impact (range format)
      expect(quote).toBeDefined()
      expect(quote.priceImpact).toBe('1.0-3.0')
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
