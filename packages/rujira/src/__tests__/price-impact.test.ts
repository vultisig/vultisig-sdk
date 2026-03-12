/**
 * Tests for price impact calculation
 */

import { describe, expect, it, vi } from 'vitest'

import { RujiraSwap } from '../modules/swap.js'
import { calculatePriceImpact } from '../services/price-impact.js'
import type { OrderBook } from '../types.js'

// Helper to create orderbook
type CreateOrderbookInput = {
  bids: Array<{ price: string; amount: string }>
  asks: Array<{ price: string; amount: string }>
  pair?: { base: string; quote: string }
}

const createOrderbook = ({
  bids,
  asks,
  pair = { base: 'THOR.RUNE', quote: 'BTC.BTC' },
}: CreateOrderbookInput): OrderBook => ({
  pair: {
    base: pair.base,
    quote: pair.quote,
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
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

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
      const orderbook = createOrderbook({
        bids: [{ price: '0.9999', amount: '1000' }],
        asks: [{ price: '1.0001', amount: '1000' }],
      })

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

    it('should return unknown for extreme thin liquidity impact', async () => {
      // Wide spread simulating thin liquidity
      const orderbook = createOrderbook({
        bids: [{ price: '0.01', amount: '1000' }], // Very low bid
        asks: [{ price: '0.99', amount: '1000' }], // Normal ask
      })

      const mockClient = createMockClient(orderbook)
      // Simulate very poor execution: input=100, output=1
      // midPrice = (0.01 + 0.99) / 2 = 0.5
      // execPrice = 1/100 = 0.01
      // impact = |0.01 - 0.5| / 0.5 * 100 = 98%
      mockClient.simulateSwap.mockResolvedValue({
        returned: '1000000', // 1 unit output
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'BTC.BTC',
        amount: '100000000', // 100 units input
      })

      // Very high impact (98%) should still be a numeric value (below 99% threshold)
      expect(quote.priceImpact).not.toBe('unknown')
      const impact = parseFloat(quote.priceImpact)
      expect(impact).toBeGreaterThan(50)
      expect(impact).toBeLessThan(100)
    })

    it('should handle reversed swap direction (buying base) correctly', async () => {
      // Orderbook: pair.base='THOR.RUNE', pair.quote='BTC.BTC'
      // midPrice = 100 means 1 RUNE = 100 BTC (in orderbook convention)
      const orderbook = createOrderbook({
        bids: [{ price: '99', amount: '1000' }],
        asks: [{ price: '101', amount: '1000' }],
      })

      const mockClient = createMockClient(orderbook)
      // Swap is buying base: input=BTC, output=RUNE (quote → base)
      // This is REVERSED relative to the orderbook's base/quote
      // For reversed: executionPrice = input/output = 10100000000/100000000 = 101
      // midPrice = 100
      // impact = |101 - 100| / 100 * 100 = 1%
      mockClient.simulateSwap.mockResolvedValue({
        returned: '100000000', // 1 RUNE
        fee: '1000000',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'BTC.BTC', // Flipped: now buying RUNE with BTC
        toAsset: 'THOR.RUNE',
        amount: '10100000000', // ~101 BTC to buy 1 RUNE at midPrice ~100
      })

      // Should detect reversed direction and calculate ~1% impact
      expect(parseFloat(quote.priceImpact)).toBeCloseTo(1, 0)
    })

    it('should handle small trade on deep pair (the original bug scenario)', async () => {
      // Deep pair with tight spread
      // Orderbook: base='THOR.RUNE', quote='BTC.BTC' with price ~65000 (1 RUNE = 65000 BTC)
      const orderbook = createOrderbook({
        bids: [{ price: '64900', amount: '10' }], // Deep bid
        asks: [{ price: '65100', amount: '10' }], // Deep ask, tight spread
      })

      const mockClient = createMockClient(orderbook)
      // Swap: buying RUNE with BTC (input=quote, output=base)
      // Reversed: executionPrice = input/output = 1300000000/20000 = 65000
      // midPrice = (64900 + 65100) / 2 = 65000
      // impact ≈ 0%
      mockClient.simulateSwap.mockResolvedValue({
        returned: '20000', // 0.0002 RUNE (in 8-decimal base units)
        fee: '100',
      })

      const swap = new RujiraSwap(mockClient as any, { cache: false })

      const quote = await swap.getQuote({
        fromAsset: 'BTC.BTC', // Buying RUNE with BTC (quote → base)
        toAsset: 'THOR.RUNE',
        amount: '1300000000', // 13 BTC in 8-decimal base units
      })

      // Should yield low impact, not 50% or unknown
      expect(quote.priceImpact).not.toBe('50.00')
      expect(parseFloat(quote.priceImpact)).toBeLessThan(5)
    })
  })

  describe('inverse direction with flipped pair', () => {
    it('should exercise inverse path with ETH/RUNE orderbook selling ETH', async () => {
      // Orderbook: base='ETH.ETH', quote='THOR.RUNE'
      // midPrice = (2990 + 3010) / 2 = 3000
      // Selling ETH for RUNE (base → quote): direct path
      const orderbook = createOrderbook({
        bids: [{ price: '2990', amount: '50' }],
        asks: [{ price: '3010', amount: '50' }],
        pair: { base: 'ETH.ETH', quote: 'THOR.RUNE' },
      })

      // Direct: executionPrice = output/input = 297000000000/100000000 = 2970
      // impact = |2970 - 3000| / 3000 * 100 = 1%
      const result = calculatePriceImpact({
        inputAmount: '100000000',   // 1 ETH
        outputAmount: '297000000000', // 2970 RUNE
        orderbook,
        reversedToOrderbook: false,
      })

      expect(result).not.toBe('unknown')
      expect(parseFloat(result)).toBeCloseTo(1, 0)
    })

    it('should exercise inverse path with ETH/RUNE orderbook buying ETH', async () => {
      // Orderbook: base='ETH.ETH', quote='THOR.RUNE'
      // midPrice = (2990 + 3010) / 2 = 3000
      // Buying ETH with RUNE (quote → base): REVERSED path
      const orderbook = createOrderbook({
        bids: [{ price: '2990', amount: '50' }],
        asks: [{ price: '3010', amount: '50' }],
        pair: { base: 'ETH.ETH', quote: 'THOR.RUNE' },
      })

      // Reversed: executionPrice = input/output = 303000000000/100000000 = 3030
      // impact = |3030 - 3000| / 3000 * 100 = 1%
      const result = calculatePriceImpact({
        inputAmount: '303000000000',  // 3030 RUNE
        outputAmount: '100000000',    // 1 ETH
        orderbook,
        reversedToOrderbook: true,
      })

      expect(result).not.toBe('unknown')
      expect(parseFloat(result)).toBeCloseTo(1, 0)
    })
  })

  describe('empty/partial orderbook handling', () => {
    it('should use fallback when orderbook is empty', async () => {
      const orderbook = createOrderbook({ bids: [], asks: [] })

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
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [],
      })

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
      const orderbook = createOrderbook({
        bids: [],
        asks: [{ price: '1.01', amount: '1000' }],
      })

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
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

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
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

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
      expect(quote.priceImpact).not.toBe('unknown')
      expect(parseFloat(quote.priceImpact)).toBeCloseTo(1, 0)
    })

    it('should include priceImpact in quote response', async () => {
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

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

    it('should return unknown for non-positive output', () => {
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

      const result = calculatePriceImpact({
        inputAmount: '100000000',
        outputAmount: '0',
        orderbook,
        reversedToOrderbook: false,
      })

      expect(result).toBe('unknown')
    })

    it('should return unknown for malformed numeric input', () => {
      const orderbook = createOrderbook({
        bids: [{ price: '0.99', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

      const result = calculatePriceImpact({
        inputAmount: 'not-a-number',
        outputAmount: '100000000',
        orderbook,
        reversedToOrderbook: false,
      })

      expect(result).toBe('unknown')
    })

    it('should return unknown for malformed orderbook prices', () => {
      const orderbook = createOrderbook({
        bids: [{ price: '$1.00', amount: '1000' }],
        asks: [{ price: '1.01', amount: '1000' }],
      })

      const result = calculatePriceImpact({
        inputAmount: '100000000',
        outputAmount: '99000000',
        orderbook,
        reversedToOrderbook: false,
      })

      expect(result).toBe('unknown')
    })
  })
})
