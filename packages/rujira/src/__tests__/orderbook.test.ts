/**
 * Tests for orderbook module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RujiraOrderbook } from '../modules/orderbook';

// Mock the client
const createMockClient = (configResponse?: object, bookResponse?: object) => ({
  config: {
    contracts: {
      finContracts: {
        'RUNE/BTC': 'thor1runebtc...',
      },
    },
  },
  getOrderBook: vi.fn().mockResolvedValue(
    bookResponse || {
      base: [
        { price: '0.00002500', total: '1000000000' },
        { price: '0.00002400', total: '2000000000' },
      ],
      quote: [
        { price: '0.00002600', total: '1500000000' },
        { price: '0.00002700', total: '2500000000' },
      ],
    }
  ),
  queryContract: vi.fn().mockResolvedValue(
    configResponse || {
      denoms: { base: 'rune', quote: 'btc-btc' },
      tick: '0.00000001',
      fee: { taker: '0.0015', maker: '0.00075' },
      last_price: '0.00002550',
    }
  ),
  getAddress: vi.fn().mockResolvedValue('thor1user...'),
});

describe('RujiraOrderbook', () => {
  describe('getOrderBook()', () => {
    it('should populate pair.base and pair.quote from contract config', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.pair.base).toBe('THOR.RUNE');
      expect(book.pair.quote).toBe('BTC.BTC');
    });

    it('should populate tick and fees from contract config', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.pair.tick).toBe('0.00000001');
      expect(book.pair.takerFee).toBe('0.0015');
      expect(book.pair.makerFee).toBe('0.00075');
    });

    it('should use lastPrice from contract config', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.lastPrice).toBe('0.00002550');
    });

    it('should calculate spread correctly using mid-price formula', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      // best_bid = 0.00002500, best_ask = 0.00002600
      // mid_price = (0.00002500 + 0.00002600) / 2 = 0.000025500
      // spread = (0.00002600 - 0.00002500) / 0.000025500 * 100 ≈ 3.9216%
      expect(parseFloat(book.spread)).toBeCloseTo(3.9216, 2);
    });

    it('should handle empty order book', async () => {
      const mockClient = createMockClient(
        { denoms: { base: 'rune', quote: 'btc-btc' } },
        { base: [], quote: [] }
      );
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.bids).toHaveLength(0);
      expect(book.asks).toHaveLength(0);
      expect(book.spread).toBe('0');
      expect(book.lastPrice).toBe('0');
    });

    it('should handle one-sided order book (bids only)', async () => {
      const mockClient = createMockClient(
        { denoms: { base: 'rune', quote: 'btc-btc' } },
        {
          base: [{ price: '0.00002500', total: '1000000000' }],
          quote: [],
        }
      );
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.bids).toHaveLength(1);
      expect(book.asks).toHaveLength(0);
      expect(book.spread).toBe('0');
      expect(book.lastPrice).toBe('0.00002500');
    });

    it('should handle one-sided order book (asks only)', async () => {
      const mockClient = createMockClient(
        { denoms: { base: 'rune', quote: 'btc-btc' } },
        {
          base: [],
          quote: [{ price: '0.00002600', total: '1500000000' }],
        }
      );
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      expect(book.bids).toHaveLength(0);
      expect(book.asks).toHaveLength(1);
      expect(book.spread).toBe('0');
      expect(book.lastPrice).toBe('0.00002600');
    });

    it('should gracefully handle config query failure', async () => {
      const mockClient = createMockClient();
      mockClient.queryContract = vi.fn().mockRejectedValue(new Error('Query failed'));
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1runebtc...');

      // Should still work but with empty pair info
      expect(book.pair.base).toBe('');
      expect(book.pair.quote).toBe('');
      expect(book.bids.length).toBeGreaterThan(0);
      expect(book.asks.length).toBeGreaterThan(0);
    });

    it('should resolve pair string to contract address', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      await orderbook.getOrderBook('RUNE/BTC');

      expect(mockClient.getOrderBook).toHaveBeenCalledWith('thor1runebtc...', 50);
    });
  });

  describe('denomToAsset conversion', () => {
    it('should convert common denoms correctly', async () => {
      const mockClient = createMockClient({
        denoms: { base: 'eth-eth', quote: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
      });
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1contract...');

      expect(book.pair.base).toBe('ETH.ETH');
      expect(book.pair.quote).toBe('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
    });

    it('should handle unknown denoms with generic conversion', async () => {
      const mockClient = createMockClient({
        denoms: { base: 'newchain-newtoken', quote: 'other-asset' },
      });
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1contract...');

      expect(book.pair.base).toBe('NEWCHAIN.NEWTOKEN');
      expect(book.pair.quote).toBe('OTHER.ASSET');
    });
  });

  describe('order book structure', () => {
    it('should sort bids in descending order (highest first)', async () => {
      const mockClient = createMockClient(
        { denoms: { base: 'rune', quote: 'btc-btc' } },
        {
          base: [
            { price: '0.00002400', total: '1000000000' },
            { price: '0.00002500', total: '2000000000' },
            { price: '0.00002300', total: '1500000000' },
          ],
          quote: [],
        }
      );
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1contract...');

      expect(book.bids[0].price).toBe('0.00002500');
      expect(book.bids[1].price).toBe('0.00002400');
      expect(book.bids[2].price).toBe('0.00002300');
    });

    it('should sort asks in ascending order (lowest first)', async () => {
      const mockClient = createMockClient(
        { denoms: { base: 'rune', quote: 'btc-btc' } },
        {
          base: [],
          quote: [
            { price: '0.00002700', total: '1000000000' },
            { price: '0.00002600', total: '2000000000' },
            { price: '0.00002800', total: '1500000000' },
          ],
        }
      );
      const orderbook = new RujiraOrderbook(mockClient as any);

      const book = await orderbook.getOrderBook('thor1contract...');

      expect(book.asks[0].price).toBe('0.00002600');
      expect(book.asks[1].price).toBe('0.00002700');
      expect(book.asks[2].price).toBe('0.00002800');
    });

    it('should include timestamp', async () => {
      const mockClient = createMockClient();
      const orderbook = new RujiraOrderbook(mockClient as any);

      const before = Date.now();
      const book = await orderbook.getOrderBook('thor1contract...');
      const after = Date.now();

      expect(book.timestamp).toBeGreaterThanOrEqual(before);
      expect(book.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
