/**
 * Token bucket rate limiter for THORNode API calls.
 *
 * THORChain quote endpoints are rate-limited to 1 request/second per IP.
 * This limiter ensures all SDK HTTP calls to THORNode respect that limit.
 *
 * @module utils/rate-limiter
 */

export interface RateLimiterOptions {
  /** Maximum requests per interval (default: 1) */
  maxTokens?: number;
  /** Interval in milliseconds to refill one token (default: 1000 = 1 req/sec) */
  refillIntervalMs?: number;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(options: RateLimiterOptions = {}) {
    this.maxTokens = options.maxTokens ?? 1;
    this.refillIntervalMs = options.refillIntervalMs ?? 1000;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = Math.floor(elapsed / this.refillIntervalMs);
    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  private processQueue(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--;
      const resolve = this.queue.shift()!;
      resolve();
    }

    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), this.refillIntervalMs);
    }
  }

  /**
   * Acquire a token. Resolves when a request slot is available.
   * Use before each HTTP call to THORNode.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      if (this.queue.length === 1) {
        setTimeout(() => this.processQueue(), this.refillIntervalMs);
      }
    });
  }

  /**
   * Wrap a fetch call with rate limiting.
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    await this.acquire();
    return fetch(url, init);
  }

  /** Number of pending requests in queue */
  get pending(): number {
    return this.queue.length;
  }
}

/** Shared rate limiter for all THORNode API calls (1 req/sec) */
export const thornodeRateLimiter = new RateLimiter({ maxTokens: 1, refillIntervalMs: 1000 });
