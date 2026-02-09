import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../utils/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request immediately', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
    // acquire() should resolve immediately for the first call
    await limiter.acquire();
    // If we get here, it didn't block
    expect(true).toBe(true);
  });

  it('blocks second request until refill', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
    await limiter.acquire(); // consumes the token

    let resolved = false;
    const secondAcquire = limiter.acquire().then(() => {
      resolved = true;
    });

    // Should not resolve immediately
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    // After refill interval, should resolve
    await vi.advanceTimersByTimeAsync(600);
    expect(resolved).toBe(true);
  });

  it('allows burst up to maxTokens', async () => {
    const limiter = new RateLimiter({ maxTokens: 3, refillIntervalMs: 1000 });

    // Should all resolve immediately
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // Fourth should queue
    let fourthResolved = false;
    limiter.acquire().then(() => {
      fourthResolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fourthResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1100);
    expect(fourthResolved).toBe(true);
  });

  it('reports pending queue length', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
    await limiter.acquire();
    expect(limiter.pending).toBe(0);

    limiter.acquire(); // queued
    limiter.acquire(); // queued
    expect(limiter.pending).toBe(2);
  });

  it('fetch() wraps global fetch with rate limiting', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
    const response = await limiter.fetch('https://example.com/api');

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', undefined);
    expect(response).toBeInstanceOf(Response);

    vi.unstubAllGlobals();
  });

  it('fetch() passes RequestInit options through', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const limiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
    const init = { method: 'POST', body: 'data' };
    await limiter.fetch('https://example.com/api', init);

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', init);

    vi.unstubAllGlobals();
  });
});
