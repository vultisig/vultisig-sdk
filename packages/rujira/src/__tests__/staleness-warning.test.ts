/**
 * Tests for quote staleness warnings (MEDIUM-1 security fix)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RujiraSwap } from '../modules/swap';

// Mock client for testing
const createMockClient = () => ({
  config: {
    defaultSlippageBps: 100,
    contracts: {
      finContracts: {
        // Use lowercase FIN-format keys to match EASY_ROUTES format
        'rune/eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'thor1contract...',
      },
    },
  },
  discovery: {
    // Return a contract for any pair to ensure tests work
    getContractAddress: vi.fn().mockImplementation(async () => 'thor1contract...'),
  },
  simulateSwap: vi.fn().mockResolvedValue({
    returned: '99000000',
    fee: '1000000',
  }),
  orderbook: {
    getOrderBook: vi.fn().mockResolvedValue({
      pair: { base: 'THOR.RUNE', quote: 'ETH.USDC', contractAddress: '', tick: '0', takerFee: '0', makerFee: '0' },
      bids: [{ price: '0.99', amount: '1000', total: '990' }],
      asks: [{ price: '1.01', amount: '1000', total: '1010' }],
      spread: '2.0',
      lastPrice: '1.00',
      timestamp: Date.now(),
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
  // Mock persistence method (no-op for tests)
  persistFinContracts: vi.fn().mockResolvedValue(undefined),
});

describe('Quote Staleness Warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cachedAt timestamp', () => {
    it('should include cachedAt in fresh quotes', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const now = Date.now();
      vi.setSystemTime(now);

      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      expect(quote.cachedAt).toBe(now);
    });
  });

  describe('staleness warnings', () => {
    it('should not warn for fresh quotes (< 5 seconds)', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Get cached quote 3 seconds later
      vi.setSystemTime(now + 3000);
      const cachedQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Should not have staleness warning
      expect(cachedQuote.warning).toBeUndefined();
    });

    it('should warn for stale quotes (> 5 seconds)', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Get cached quote 7 seconds later
      vi.setSystemTime(now + 7000);
      const cachedQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Should have staleness warning
      expect(cachedQuote.warning).toContain('7s old');
      expect(cachedQuote.warning).toContain('volatile markets');
    });
  });

  describe('maxStalenessMs option', () => {
    it('should return fresh quote when cache exceeds maxStalenessMs', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      const firstQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Advance time by 3 seconds
      vi.setSystemTime(now + 3000);

      // Request with maxStalenessMs of 2 seconds - should fetch fresh
      const secondQuote = await swap.getQuote(
        {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        { maxStalenessMs: 2000 }
      );

      // Should have different quoteId (fresh quote)
      expect(secondQuote.quoteId).not.toBe(firstQuote.quoteId);
      expect(secondQuote.cachedAt).toBe(now + 3000);
    });

    it('should return cached quote when within maxStalenessMs', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      const firstQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Advance time by 3 seconds
      vi.setSystemTime(now + 3000);

      // Request with maxStalenessMs of 5 seconds - should use cache
      const secondQuote = await swap.getQuote(
        {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        { maxStalenessMs: 5000 }
      );

      // Should have same quoteId (cached)
      expect(secondQuote.quoteId).toBe(firstQuote.quoteId);
    });
  });

  describe('skipCache backward compatibility', () => {
    it('should support boolean skipCache (backward compatible)', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      const firstQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Force fresh quote with boolean
      vi.setSystemTime(now + 1000);
      const secondQuote = await swap.getQuote(
        {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        true // skipCache = true
      );

      // Should have different quoteId
      expect(secondQuote.quoteId).not.toBe(firstQuote.quoteId);
    });

    it('should support object options with skipCache', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any); // Enable cache

      // Get first quote
      const now = Date.now();
      vi.setSystemTime(now);
      const firstQuote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      // Force fresh quote with object
      vi.setSystemTime(now + 1000);
      const secondQuote = await swap.getQuote(
        {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        { skipCache: true }
      );

      // Should have different quoteId
      expect(secondQuote.quoteId).not.toBe(firstQuote.quoteId);
    });
  });
});

describe('Price Impact Warning (MEDIUM-3)', () => {
  it('should include warning when orderbook unavailable', async () => {
    const mockClient = createMockClient();
    // Make orderbook fetch fail
    mockClient.orderbook.getOrderBook.mockRejectedValue(new Error('No orderbook'));

    const swap = new RujiraSwap(mockClient as any, { cache: false });

    const quote = await swap.getQuote({
      fromAsset: 'THOR.RUNE',
      toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      amount: '100000000',
    });

    expect(quote.warning).toContain('Price impact is estimated');
    expect(quote.warning).toContain('orderbook data unavailable');
    expect(quote.priceImpact).toBe('1.0-3.0'); // Range format when orderbook unavailable
  });

  it('should include warning when orderbook is empty', async () => {
    const mockClient = createMockClient();
    // Return empty orderbook
    mockClient.orderbook.getOrderBook.mockResolvedValue({
      pair: { base: '', quote: '', contractAddress: '', tick: '0', takerFee: '0', makerFee: '0' },
      bids: [],
      asks: [],
      spread: '0',
      lastPrice: '0',
      timestamp: Date.now(),
    });

    const swap = new RujiraSwap(mockClient as any, { cache: false });

    const quote = await swap.getQuote({
      fromAsset: 'THOR.RUNE',
      toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      amount: '100000000',
    });

    expect(quote.warning).toContain('Price impact is estimated');
  });

  it('should not include warning when orderbook has data', async () => {
    const mockClient = createMockClient();
    // Return valid orderbook (default mock has data)

    const swap = new RujiraSwap(mockClient as any, { cache: false });

    const quote = await swap.getQuote({
      fromAsset: 'THOR.RUNE',
      toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      amount: '100000000',
    });

    // Should not have price impact warning (may have staleness warning)
    // If warning exists, check it doesn't contain price impact message
    if (quote.warning) {
      expect(quote.warning).not.toContain('Price impact is estimated');
    } else {
      expect(quote.warning).toBeUndefined();
    }
  });
});
