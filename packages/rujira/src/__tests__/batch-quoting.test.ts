/**
 * Tests for batch quoting functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RujiraSwap } from '../modules/swap.js';
import { EASY_ROUTES } from '../easy-routes.js';
import type { EasyRouteName } from '../easy-routes.js';

// Track which routes have been simulated
let simulatedRoutes: string[] = [];

// Mock the client
const createMockClient = (failingContractPatterns: string[] = []) => {
  simulatedRoutes = [];

  return {
    config: {
      defaultSlippageBps: 100,
      contracts: {
        finContracts: {} as Record<string, string>,
      },
    },
    discovery: {
      getContractAddress: vi.fn().mockImplementation(async (from: string, to: string) => {
        // Return a mock contract for all pairs
        return `thor1mock_${from}_${to}`;
      }),
    },
    simulateSwap: vi.fn().mockImplementation(async (contract: string, denom: string) => {
      // Check if this contract should fail (based on the contract address which contains from/to)
      simulatedRoutes.push(contract);

      if (failingContractPatterns.some((pattern) => contract.toLowerCase().includes(pattern.toLowerCase()))) {
        throw new Error(`Simulation failed for ${contract}`);
      }

      return {
        returned: '99000000',
        fee: '1000000',
      };
    }),
    orderbook: {
      getOrderBook: vi.fn().mockResolvedValue({
        pair: { base: '', quote: '', contractAddress: '', tick: '0', takerFee: '0', makerFee: '0' },
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
  };
};

describe('Batch Quoting', () => {
  describe('batchGetQuotes()', () => {
    it('should return quotes for all requested routes', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const routes: EasyRouteName[] = ['RUNE_TO_USDC', 'RUNE_TO_BTC', 'RUNE_TO_ETH'];
      const quotes = await swap.batchGetQuotes(routes, '100000000');

      expect(quotes.size).toBe(3);
      expect(quotes.get('RUNE_TO_USDC')).not.toBeNull();
      expect(quotes.get('RUNE_TO_BTC')).not.toBeNull();
      expect(quotes.get('RUNE_TO_ETH')).not.toBeNull();
    });

    it('should execute quotes in parallel', async () => {
      const mockClient = createMockClient();
      let parallelCount = 0;
      let maxParallel = 0;

      mockClient.simulateSwap = vi.fn().mockImplementation(async () => {
        parallelCount++;
        maxParallel = Math.max(maxParallel, parallelCount);
        // Small delay to allow parallelism detection
        await new Promise((r) => setTimeout(r, 10));
        parallelCount--;
        return { returned: '99000000', fee: '1000000' };
      });

      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await swap.batchGetQuotes(
        ['RUNE_TO_USDC', 'RUNE_TO_BTC', 'RUNE_TO_ETH'],
        '100000000'
      );

      // Should have seen multiple concurrent requests
      expect(maxParallel).toBeGreaterThan(1);
    });

    it('should return null for failed routes without throwing', async () => {
      // Use lowercase FIN format to match actual asset names
      const mockClient = createMockClient(['btc-btc']); // BTC routes will fail
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const routes: EasyRouteName[] = ['RUNE_TO_USDC', 'RUNE_TO_BTC'];
      const quotes = await swap.batchGetQuotes(routes, '100000000');

      expect(quotes.size).toBe(2);
      expect(quotes.get('RUNE_TO_USDC')).not.toBeNull();
      expect(quotes.get('RUNE_TO_BTC')).toBeNull(); // Failed route
    });

    it('should handle all routes failing gracefully', async () => {
      // Use lowercase FIN format to match actual asset names
      const mockClient = createMockClient(['rune', 'btc-btc', 'eth-', 'usdc']); // All fail
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const routes: EasyRouteName[] = ['RUNE_TO_USDC', 'RUNE_TO_BTC'];
      const quotes = await swap.batchGetQuotes(routes, '100000000');

      expect(quotes.size).toBe(2);
      expect(quotes.get('RUNE_TO_USDC')).toBeNull();
      expect(quotes.get('RUNE_TO_BTC')).toBeNull();
    });

    it('should return null for unknown route names', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const routes = ['RUNE_TO_USDC', 'UNKNOWN_ROUTE' as EasyRouteName];
      const quotes = await swap.batchGetQuotes(routes, '100000000');

      expect(quotes.size).toBe(2);
      expect(quotes.get('RUNE_TO_USDC')).not.toBeNull();
      expect(quotes.get('UNKNOWN_ROUTE' as EasyRouteName)).toBeNull();
    });

    it('should pass destination to quotes', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const getQuoteSpy = vi.spyOn(swap, 'getQuote');

      await swap.batchGetQuotes(
        ['RUNE_TO_USDC'],
        '100000000',
        'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl'
      );

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: 'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl',
        })
      );
    });

    it('should respect quote cache', async () => {
      const mockClient = createMockClient();
      // Enable cache
      const swap = new RujiraSwap(mockClient as any, { cache: { ttlMs: 10000 } });

      // First batch
      await swap.batchGetQuotes(['RUNE_TO_USDC'], '100000000');
      const firstCallCount = mockClient.simulateSwap.mock.calls.length;

      // Second batch with same route (should hit cache)
      await swap.batchGetQuotes(['RUNE_TO_USDC'], '100000000');
      const secondCallCount = mockClient.simulateSwap.mock.calls.length;

      // Should not have made additional simulate calls
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('getAllRouteQuotes()', () => {
    it('should quote all defined EASY_ROUTES', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quotes = await swap.getAllRouteQuotes('100000000');

      const allRouteNames = Object.keys(EASY_ROUTES) as EasyRouteName[];
      expect(quotes.size).toBe(allRouteNames.length);

      for (const routeName of allRouteNames) {
        expect(quotes.has(routeName)).toBe(true);
      }
    });

    it('should pass destination to all quotes', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const batchSpy = vi.spyOn(swap, 'batchGetQuotes');

      await swap.getAllRouteQuotes('100000000', 'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl');

      expect(batchSpy).toHaveBeenCalledWith(
        expect.any(Array),
        '100000000',
        'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl'
      );
    });

    it('should handle mixed success/failure gracefully', async () => {
      // Use lowercase FIN format to match actual asset names
      const mockClient = createMockClient(['btc-btc']); // BTC routes fail
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quotes = await swap.getAllRouteQuotes('100000000');

      // Some routes should succeed
      expect(quotes.get('RUNE_TO_USDC')).not.toBeNull();
      expect(quotes.get('RUNE_TO_ETH')).not.toBeNull();

      // BTC routes should fail
      expect(quotes.get('RUNE_TO_BTC')).toBeNull();
      expect(quotes.get('BTC_TO_RUNE')).toBeNull();
    });
  });

  describe('quote result structure', () => {
    it('should include expected fields in successful quotes', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quotes = await swap.batchGetQuotes(['RUNE_TO_USDC'], '100000000');
      const quote = quotes.get('RUNE_TO_USDC');

      expect(quote).not.toBeNull();
      expect(quote).toMatchObject({
        params: expect.objectContaining({
          // Asset names now use lowercase FIN format
          fromAsset: 'rune',
          toAsset: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          amount: '100000000',
        }),
        expectedOutput: expect.any(String),
        minimumOutput: expect.any(String),
        rate: expect.any(String),
        priceImpact: expect.any(String),
        fees: expect.objectContaining({
          total: expect.any(String),
        }),
        quoteId: expect.any(String),
        expiresAt: expect.any(Number),
      });
    });
  });
});
