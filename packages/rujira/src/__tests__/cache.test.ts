/**
 * Tests for QuoteCache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuoteCache } from '../utils/cache';

describe('QuoteCache', () => {
  let cache: QuoteCache<string>;

  beforeEach(() => {
    cache = new QuoteCache<string>({ ttlMs: 1000 }); // 1 second TTL for tests
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');

      const result = cache.get('BTC.BTC', 'THOR.RUNE', '100000000');
      expect(result).toBe('quote-1');
    });

    it('should return null for missing keys', () => {
      const result = cache.get('BTC.BTC', 'THOR.RUNE', '100000000');
      expect(result).toBeNull();
    });

    it('should differentiate by amount', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-100');
      cache.set('BTC.BTC', 'THOR.RUNE', '200000000', 'quote-200');

      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBe('quote-100');
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '200000000')).toBe('quote-200');
    });

    it('should differentiate by trading pair', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'btc-rune');
      cache.set('ETH.ETH', 'THOR.RUNE', '100000000', 'eth-rune');

      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBe('btc-rune');
      expect(cache.get('ETH.ETH', 'THOR.RUNE', '100000000')).toBe('eth-rune');
    });
  });

  describe('TTL expiration', () => {
    it('should return null for expired entries', async () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');

      // Verify it exists initially
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBe('quote-1');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired now
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBeNull();
    });

    it('should refresh TTL on re-set', async () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');

      // Wait 500ms (half of TTL)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Re-set the value (refreshes TTL)
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-2');

      // Wait another 600ms (would be expired if not refreshed)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should still be valid with new value
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBe('quote-2');
    });
  });

  describe('has()', () => {
    it('should return true for valid entries', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      expect(cache.has('BTC.BTC', 'THOR.RUNE', '100000000')).toBe(true);
    });

    it('should return false for missing entries', () => {
      expect(cache.has('BTC.BTC', 'THOR.RUNE', '100000000')).toBe(false);
    });

    it('should return false for expired entries', async () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(cache.has('BTC.BTC', 'THOR.RUNE', '100000000')).toBe(false);
    });
  });

  describe('invalidate()', () => {
    it('should remove specific entries', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      cache.set('BTC.BTC', 'THOR.RUNE', '200000000', 'quote-2');

      cache.invalidate('BTC.BTC', 'THOR.RUNE', '100000000');

      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBeNull();
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '200000000')).toBe('quote-2');
    });
  });

  describe('invalidatePair()', () => {
    it('should remove all entries for a trading pair', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      cache.set('BTC.BTC', 'THOR.RUNE', '200000000', 'quote-2');
      cache.set('ETH.ETH', 'THOR.RUNE', '100000000', 'quote-3');

      cache.invalidatePair('BTC.BTC', 'THOR.RUNE');

      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBeNull();
      expect(cache.get('BTC.BTC', 'THOR.RUNE', '200000000')).toBeNull();
      expect(cache.get('ETH.ETH', 'THOR.RUNE', '100000000')).toBe('quote-3');
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      cache.set('ETH.ETH', 'THOR.RUNE', '100000000', 'quote-2');

      cache.clear();

      expect(cache.get('BTC.BTC', 'THOR.RUNE', '100000000')).toBeNull();
      expect(cache.get('ETH.ETH', 'THOR.RUNE', '100000000')).toBeNull();
    });
  });

  describe('stats()', () => {
    it('should return cache statistics', () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');
      cache.set('ETH.ETH', 'THOR.RUNE', '100000000', 'quote-2');

      const stats = cache.stats();

      expect(stats.size).toBe(2);
      expect(stats.ttlMs).toBe(1000);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe('max size enforcement', () => {
    it('should evict oldest entries when max size reached', () => {
      const smallCache = new QuoteCache<string>({ ttlMs: 10000, maxSize: 3 });

      smallCache.set('A', 'B', '1', 'first');
      smallCache.set('A', 'B', '2', 'second');
      smallCache.set('A', 'B', '3', 'third');
      smallCache.set('A', 'B', '4', 'fourth');

      expect(smallCache.stats().size).toBe(3);
      // First entry should have been evicted
      expect(smallCache.get('A', 'B', '1')).toBeNull();
      expect(smallCache.get('A', 'B', '4')).toBe('fourth');
    });
  });

  describe('prune()', () => {
    it('should remove expired entries', async () => {
      cache.set('BTC.BTC', 'THOR.RUNE', '100000000', 'quote-1');

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const pruned = cache.prune();

      expect(pruned).toBe(1);
      expect(cache.stats().size).toBe(0);
    });
  });
});
