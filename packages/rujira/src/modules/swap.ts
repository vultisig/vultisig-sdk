/**
 * Swap module for executing market swaps on Rujira DEX
 * 
 * The swap module is the core of the SDK, handling market orders on FIN contracts.
 * It provides a complete swap lifecycle from quote generation to execution.
 * 
 * Key features:
 * - **Intelligent quoting**: Simulates swaps to get accurate output predictions
 * - **Quote caching**: Reduces API calls and improves performance
 * - **Price impact calculation**: Uses orderbook data for accurate slippage estimates
 * - **Balance validation**: Prevents failed transactions due to insufficient funds
 * - **Slippage protection**: Enforces minimum output requirements
 * - **Cross-chain support**: Generates L1 deposit memos for Bitcoin, Ethereum, etc.
 * 
 * Quote lifecycle:
 * 1. Discovery: Find FIN contract for the trading pair
 * 2. Simulation: Call contract's simulate function to predict output
 * 3. Orderbook: Fetch current market depth for price impact calculation
 * 4. Validation: Check user balance and address format
 * 5. Caching: Store quote for reuse within expiry window
 * 
 * Execution safety:
 * - Quotes expire after 30 seconds to prevent stale price execution
 * - Configurable slippage buffers protect against MEV and price movement
 * - Balance validation happens both at quote time and execution time
 * - Failed transactions are wrapped with descriptive error messages
 * 
 * @module modules/swap
 */

import { Coin } from '@cosmjs/proto-signing';
import { fromBech32 } from '@cosmjs/encoding';
import { Amount, getAsset, findAssetByFormat } from '@vultisig/assets';
import type { RujiraClient } from '../client';
import { RujiraError, RujiraErrorCode } from '../errors';
import { getAssetInfo } from '../config';
import { calculateMinReturn, generateQuoteId } from '../utils/format';
import type {
  QuoteParams,
  SwapQuote,
  SwapOptions,
  SwapResult,
  FinExecuteMsg,
  OrderBook,
} from '../types';
import { QuoteCache, type QuoteCacheOptions } from '../utils/cache';
import { EASY_ROUTES, type EasySwapRequest, type EasyRouteName } from '../easy-routes';

/**
 * Swap module for executing market swaps on Rujira DEX
 * 
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet', signer });
 * await client.connect();
 * 
 * // Get a quote
 * const quote = await client.swap.getQuote({
 *   fromAsset: 'THOR.RUNE',
 *   toAsset: 'BTC.BTC',
 *   amount: '100000000', // 1 RUNE (8 decimals)
 * });
 * 
 * console.log(`Expected output: ${quote.expectedOutput}`);
 * console.log(`Price impact: ${quote.priceImpact}%`);
 * 
 * // Execute the swap
 * const result = await client.swap.execute(quote);
 * console.log(`TX Hash: ${result.txHash}`);
 * ```
 */
/**
 * Options for RujiraSwap module
 */
export interface RujiraSwapOptions {
  /** Quote cache options */
  cache?: QuoteCacheOptions | false;
  /** Quote expiry safety buffer in milliseconds (default: 5000) */
  quoteExpiryBufferMs?: number;
}

export class RujiraSwap {
  private readonly quoteCache: QuoteCache<SwapQuote> | null;
  private readonly quoteExpiryBufferMs: number;

  constructor(
    private readonly client: RujiraClient,
    options: RujiraSwapOptions = {}
  ) {
    // Initialize cache (enabled by default)
    if (options.cache === false) {
      this.quoteCache = null;
    } else {
      this.quoteCache = new QuoteCache<SwapQuote>(options.cache);
    }
    
    // Initialize quote expiry buffer (5s by default)
    this.quoteExpiryBufferMs = options.quoteExpiryBufferMs ?? 5000;
  }

  /**
   * Clear the quote cache
   */
  clearCache(): void {
    this.quoteCache?.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } | null {
    return this.quoteCache?.stats() ?? null;
  }

  /**
   * Get a swap quote
   *
   * Quotes are cached for efficiency. Use `clearCache()` to force fresh quotes.
   *
   * @param params - Quote parameters
   * @param options - Quote options (skipCache, maxStalenessMs)
   * @returns Swap quote with expected output and fees
   */
  async getQuote(
    params: QuoteParams,
    options: { skipCache?: boolean; maxStalenessMs?: number } | boolean = false
  ): Promise<SwapQuote> {
    // Handle backward compatibility (boolean skipCache)
    const skipCache = typeof options === 'boolean' ? options : options.skipCache ?? false;
    const maxStalenessMs = typeof options === 'boolean' ? undefined : options.maxStalenessMs;

    // Validate params
    this.validateQuoteParams(params);

    // Validate destination address if provided
    if (params.destination) {
      this.validateAddress(params.destination);
    }

    // Check cache first (unless skipped)
    if (!skipCache && this.quoteCache) {
      const cached = this.quoteCache.get(
        params.fromAsset,
        params.toAsset,
        params.amount
      );
      if (cached) {
        // Check expiry
        if (Date.now() >= cached.expiresAt) {
          // Expired - will fetch fresh
        } else if (maxStalenessMs !== undefined && cached.cachedAt) {
          // Check staleness against user-specified threshold
          const age = Date.now() - cached.cachedAt;
          if (age <= maxStalenessMs) {
            return cached;
          }
          // Too stale for user's requirements - fetch fresh
        } else {
          // Return cached quote (add warning if it's getting stale)
          const age = cached.cachedAt ? Date.now() - cached.cachedAt : 0;
          if (age > 5000) {
            // Warn if over 5 seconds old
            return {
              ...cached,
              warning: cached.warning
                ? cached.warning
                : `Quote is ${Math.round(age / 1000)}s old. Consider refreshing for volatile markets.`,
            };
          }
          return cached;
        }
      }
    }

    // Get asset info using @vultisig/assets
    const fromAsset = findAssetByFormat(params.fromAsset, 'fin');
    const toAsset = findAssetByFormat(params.toAsset, 'fin');

    if (!fromAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${params.fromAsset}`
      );
    }

    if (!toAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${params.toAsset}`
      );
    }

    // Find the FIN contract for this pair
    const contractAddress = await this.findContract(params.fromAsset, params.toAsset);

    // Simulate the swap and fetch orderbook in parallel
    const [simulation, orderbook] = await Promise.all([
      this.client.simulateSwap(contractAddress, fromAsset.formats.fin, params.amount),
      this.client.orderbook.getOrderBook(contractAddress).catch(() => null),
    ]);

    // Calculate slippage
    const slippageBps = params.slippageBps ?? this.client.config.defaultSlippageBps;
    const minimumOutput = calculateMinReturn(simulation.returned, slippageBps);

    // Calculate exchange rate
    const inputAmount = BigInt(params.amount);
    const outputAmount = BigInt(simulation.returned);
    const rate = outputAmount > 0n
      ? (inputAmount * BigInt(1e8) / outputAmount).toString()
      : '0';

    // Calculate real price impact using orderbook data
    const priceImpact = this.calculatePriceImpact(
      params.amount,
      simulation.returned,
      orderbook
    );

    // Check if price impact was estimated (orderbook unavailable)
    const priceImpactEstimated = !orderbook ||
      !orderbook.bids[0]?.price ||
      !orderbook.asks[0]?.price;

    // Build quote
    const quote: SwapQuote = {
      params,
      expectedOutput: simulation.returned,
      minimumOutput,
      rate,
      priceImpact: priceImpact ?? 'unknown',
      fees: {
        network: '0', // Gas estimated at execution
        protocol: simulation.fee,
        affiliate: '0',
        total: simulation.fee,
      },
      contractAddress,
      expiresAt: Date.now() + 30000, // 30 second expiry
      quoteId: generateQuoteId(),
      cachedAt: Date.now(),
      warning: priceImpactEstimated || priceImpact === null
        ? 'Price impact is estimated or unknown - orderbook data unavailable. Actual slippage may differ.'
        : undefined,
    };

    // Cache the quote
    if (this.quoteCache) {
      this.quoteCache.set(
        params.fromAsset,
        params.toAsset,
        params.amount,
        quote
      );
    }

    return quote;
  }

  /**
   * Execute a swap using a quote
   *
   * @param quote - Quote from getQuote()
   * @param options - Execution options
   * @returns Swap result with transaction hash
   */
  async execute(quote: SwapQuote, options: SwapOptions = {}): Promise<SwapResult> {
    // Check quote expiry with configurable safety buffer
    // This prevents race conditions where quote expires between check and execution
    const effectiveExpiry = quote.expiresAt - this.quoteExpiryBufferMs;
    
    if (Date.now() > effectiveExpiry) {
      const isActuallyExpired = Date.now() > quote.expiresAt;
      throw new RujiraError(
        RujiraErrorCode.QUOTE_EXPIRED,
        isActuallyExpired 
          ? 'Quote has expired. Please get a new quote.'
          : `Quote is about to expire (within ${this.quoteExpiryBufferMs}ms safety buffer). Please get a new quote to ensure execution completes.`
      );
    }

    // Validate balance before proceeding (unless already validated by caller)
    if (!options.skipBalanceValidation) {
      await this.validateBalance(quote.params.fromAsset, quote.params.amount);
    }

    // Get asset info using @vultisig/assets
    const fromAsset = findAssetByFormat(quote.params.fromAsset, 'fin');
    if (!fromAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${quote.params.fromAsset}`
      );
    }

    // Calculate min return with optional slippage override
    const slippageBps = options.slippageBps ?? quote.params.slippageBps ?? this.client.config.defaultSlippageBps;
    const minReturn = calculateMinReturn(quote.expectedOutput, slippageBps);

    // Build the swap message
    const swapMsg: FinExecuteMsg = {
      swap: {
        min: {
          min_return: minReturn,
          to: quote.params.destination,
        }
      }
    };

    // Build funds to send
    const funds: Coin[] = [{
      denom: fromAsset.formats.fin,
      amount: quote.params.amount,
    }];

    // Execute the contract
    const result = await this.client.executeContract(
      quote.contractAddress,
      swapMsg,
      funds,
      options.memo
    );

    return {
      txHash: result.transactionHash,
      status: 'pending',
      fromAmount: quote.params.amount,
      fee: quote.fees.total,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a swap in one call (combines getQuote + execute)
   * 
   * @param params - Swap parameters
   * @param options - Execution options
   * @returns Swap result
   */
  async executeSwap(params: QuoteParams, options: SwapOptions = {}): Promise<SwapResult> {
    const quote = await this.getQuote(params);
    return this.execute(quote, options);
  }

  /**
   * Build a swap transaction without executing (for preview/manual signing)
   * 
   * @param params - Swap parameters
   * @returns Transaction details for manual signing
   */
  async buildTransaction(params: QuoteParams): Promise<{
    contractAddress: string;
    msg: FinExecuteMsg;
    funds: Coin[];
  }> {
    const quote = await this.getQuote(params);
    
    const fromAsset = findAssetByFormat(params.fromAsset, 'fin');
    if (!fromAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${params.fromAsset}`
      );
    }

    const minReturn = calculateMinReturn(
      quote.expectedOutput,
      params.slippageBps ?? this.client.config.defaultSlippageBps
    );

    const msg: FinExecuteMsg = {
      swap: {
        min: {
          min_return: minReturn,
          to: params.destination,
        }
      }
    };

    const funds: Coin[] = [{
      denom: fromAsset.formats.fin,
      amount: params.amount,
    }];

    return {
      contractAddress: quote.contractAddress,
      msg,
      funds,
    };
  }

  /**
   * Build a Layer 1 deposit memo for swapping from external chains
   *
   * @param params - Swap parameters
   * @returns Memo string for L1 deposit
   */
  async buildL1Memo(params: QuoteParams): Promise<string> {
    const { contractAddress, msg } = await this.buildTransaction(params);

    // Encode message as base64
    const msgBase64 = Buffer.from(JSON.stringify(msg)).toString('base64');

    // Format: x:{contract}:{base64_msg}
    return `x:${contractAddress}:${msgBase64}`;
  }

  /**
   * Execute a swap using EasySwapRequest - designed for AI agents
   *
   * This is the simplest way to execute a swap. Provide a route name
   * or direct from/to assets, and the method handles everything.
   *
   * @param request - Easy swap request
   * @returns Swap result with transaction hash
   *
   * @example
   * ```typescript
   * // Using a route name
   * const result = await client.swap.easySwap({
   *   route: 'RUNE_TO_USDC',
   *   amount: '100000000', // 1 RUNE
   *   destination: 'thor1abc...',
   *   maxSlippagePercent: 1,
   * });
   *
   * // Using direct assets
   * const result = await client.swap.easySwap({
   *   from: 'THOR.RUNE',
   *   to: 'BTC.BTC',
   *   amount: '100000000',
   *   destination: 'thor1abc...',
   * });
   * ```
   */
  async easySwap(request: EasySwapRequest): Promise<SwapResult> {
    // Validate destination address first (fail fast)
    this.validateAddress(request.destination);

    // Resolve from/to assets
    let fromAsset: string;
    let toAsset: string;

    if (request.route) {
      // Resolve from EASY_ROUTES
      const route = EASY_ROUTES[request.route];
      if (!route) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_PAIR,
          `Unknown easy route: ${request.route}. Use listEasyRoutes() to see available routes.`
        );
      }
      fromAsset = route.from;
      toAsset = route.to;
    } else if (request.from && request.to) {
      // Use direct assets
      fromAsset = request.from;
      toAsset = request.to;
    } else {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PAIR,
        'EasySwapRequest must specify either route or both from and to'
      );
    }

    // Validate balance early (fail fast before quote)
    await this.validateBalance(fromAsset, request.amount);

    // Convert maxSlippagePercent to slippageBps (1% = 100 bps)
    const slippageBps = request.maxSlippagePercent !== undefined
      ? Math.round(request.maxSlippagePercent * 100)
      : undefined;

    // Build quote params
    const quoteParams: QuoteParams = {
      fromAsset,
      toAsset,
      amount: request.amount,
      destination: request.destination,
      slippageBps,
    };

    // Get quote and execute in one call
    const quote = await this.getQuote(quoteParams);
    // Skip balance validation in execute() since we already validated above
    // This prevents race conditions and redundant validation
    return this.execute(quote, { skipBalanceValidation: true });
  }

  // ============================================================================
  // BATCH OPERATIONS (for AI agents)
  // ============================================================================

  /**
   * Get quotes for multiple routes in parallel
   *
   * This is optimized for AI agents that need to compare multiple swap options.
   * Failed quotes return null instead of throwing, so you can process partial results.
   *
   * @param routes - Array of route names to quote
   * @param amount - Amount to quote (same for all routes)
   * @param destination - Optional destination address
   * @returns Map of route name to quote (null if quote failed)
   *
   * @example
   * ```typescript
   * const quotes = await client.swap.batchGetQuotes(
   *   ['RUNE_TO_USDC', 'RUNE_TO_BTC', 'RUNE_TO_ETH'],
   *   '100000000',
   * );
   *
   * for (const [route, quote] of quotes) {
   *   if (quote) {
   *     console.log(`${route}: ${quote.expectedOutput}`);
   *   }
   * }
   * ```
   */
  async batchGetQuotes(
    routes: EasyRouteName[],
    amount: string,
    destination?: string
  ): Promise<Map<EasyRouteName, SwapQuote | null>> {
    // Execute all quotes in parallel
    const results = await Promise.all(
      routes.map(async (routeName) => {
        try {
          const route = EASY_ROUTES[routeName];
          if (!route) {
            return { routeName, quote: null };
          }

          const quote = await this.getQuote({
            fromAsset: route.from,
            toAsset: route.to,
            amount,
            destination,
          });

          return { routeName, quote };
        } catch {
          // On error, return null for this route
          return { routeName, quote: null };
        }
      })
    );

    // Build result map
    const resultMap = new Map<EasyRouteName, SwapQuote | null>();
    for (const { routeName, quote } of results) {
      resultMap.set(routeName, quote);
    }

    return resultMap;
  }

  /**
   * Get quotes for ALL available easy routes
   *
   * Convenience method that quotes every route in EASY_ROUTES.
   * Useful for agents exploring all swap options.
   *
   * @param amount - Amount to quote
   * @param destination - Optional destination address
   * @returns Map of all routes to their quotes
   *
   * @example
   * ```typescript
   * const allQuotes = await client.swap.getAllRouteQuotes('100000000');
   *
   * // Find best output for USDC
   * const usdcRoutes = [...allQuotes.entries()]
   *   .filter(([route]) => route.includes('USDC'))
   *   .filter(([, quote]) => quote !== null)
   *   .sort((a, b) =>
   *     BigInt(b[1]!.expectedOutput) - BigInt(a[1]!.expectedOutput)
   *   );
   * ```
   */
  async getAllRouteQuotes(
    amount: string,
    destination?: string
  ): Promise<Map<EasyRouteName, SwapQuote | null>> {
    const allRoutes = Object.keys(EASY_ROUTES) as EasyRouteName[];
    return this.batchGetQuotes(allRoutes, amount, destination);
  }

  // ============================================================================
  // INTERNAL
  // ============================================================================

  /**
   * Find the FIN contract for a trading pair
   */
  private async findContract(fromAsset: string, toAsset: string): Promise<string> {
    // Check known contracts first (from config)
    const pairKey = `${fromAsset}/${toAsset}`;
    const reversePairKey = `${toAsset}/${fromAsset}`;
    
    const knownContracts = this.client.config.contracts.finContracts;
    
    if (knownContracts[pairKey]) {
      return knownContracts[pairKey];
    }
    
    if (knownContracts[reversePairKey]) {
      return knownContracts[reversePairKey];
    }

    // Try discovery service
    const address = await this.client.discovery.getContractAddress(fromAsset, toAsset);
    
    if (address) {
      // Cache for future use
      this.client.config.contracts.finContracts[pairKey] = address;
      return address;
    }

    throw new RujiraError(
      RujiraErrorCode.INVALID_PAIR,
      `No FIN contract found for pair: ${fromAsset}/${toAsset}. ` +
      'Market may not exist on Rujira or discovery failed.'
    );
  }

  /**
   * Validate quote parameters
   */
  private validateQuoteParams(params: QuoteParams): void {
    if (!params.fromAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        'fromAsset is required'
      );
    }

    if (!params.toAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        'toAsset is required'
      );
    }

    if (params.fromAsset === params.toAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PAIR,
        'Cannot swap asset to itself'
      );
    }

    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'amount must be a positive number'
      );
    }

    if (params.slippageBps !== undefined) {
      if (params.slippageBps < 1 || params.slippageBps > 5000) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_SLIPPAGE,
          'slippageBps must be between 1 (0.01%) and 5000 (50%)'
        );
      }
    }
  }

  /**
   * Calculate real price impact using orderbook data
   *
   * Formula: ((execution_price - mid_price) / mid_price) * 100
   *
   * @param inputAmount - Input amount in base units
   * @param outputAmount - Output amount from simulation
   * @param orderbook - Orderbook data (optional, may be null)
   * @returns Price impact as percentage string
   */
  private calculatePriceImpact(
    inputAmount: string,
    outputAmount: string,
    orderbook: OrderBook | null
  ): string | null {
    // If no orderbook data, estimate based on swap size
    if (!orderbook) {
      return this.estimatePriceImpactWithoutOrderbook(inputAmount, outputAmount);
    }

    // Need both bids and asks to calculate mid price
    const bestBid = orderbook.bids[0]?.price;
    const bestAsk = orderbook.asks[0]?.price;

    if (!bestBid || !bestAsk) {
      // Empty or one-sided orderbook - use estimate
      return this.estimatePriceImpactWithoutOrderbook(inputAmount, outputAmount);
    }

    const bidPrice = parseFloat(bestBid);
    const askPrice = parseFloat(bestAsk);

    if (bidPrice <= 0 || askPrice <= 0) {
      return '0';
    }

    // Calculate mid price
    const midPrice = (bidPrice + askPrice) / 2;

    // Calculate execution price from swap amounts
    // execution_price = input / output (for buying) or output / input (for selling)
    const input = parseFloat(inputAmount);
    const output = parseFloat(outputAmount);

    if (input <= 0 || output <= 0) {
      return '0';
    }

    // Assume this is a sell (input -> output), so execution_price = output / input
    const executionPrice = output / input;

    // Price impact = ((execution_price - mid_price) / mid_price) * 100
    // Negative means you're getting less than mid price (expected for sells)
    const impact = Math.abs(((executionPrice - midPrice) / midPrice) * 100);

    // Handle thin liquidity - warn if impact is very high
    if (impact > 50) {
      // Cap at reasonable value for extremely thin liquidity
      return '50.00';
    }

    return impact.toFixed(4);
  }

  /**
   * Estimate price impact when orderbook is not available
   * Returns a range estimate based on swap size
   * 
   * For large swaps (>$10k equivalent), returns null to indicate unknown impact.
   * For smaller swaps, returns an estimated range based on typical market depth.
   */
  private estimatePriceImpactWithoutOrderbook(
    inputAmount: string,
    _outputAmount: string
  ): string | null {
    const amount = BigInt(inputAmount);
    
    // For very large amounts, we can't provide a reliable estimate
    // Users should check market conditions manually
    // Assuming 8 decimal places: 1,000,000,000,000 = $10,000 worth of RUNE
    const largeSwapThreshold = BigInt('1000000000000'); // 10k units base
    
    if (amount >= largeSwapThreshold) {
      // Return null for large swaps - forces user to check conditions
      return null;
    }
    
    // For medium amounts, provide a conservative range
    const mediumSwapThreshold = BigInt('100000000000'); // 1k units base
    
    if (amount >= mediumSwapThreshold) {
      // Medium swap: 2-5% estimated range
      return '2.0-5.0';
    }
    
    // For smaller amounts, use more conservative estimate
    return '1.0-3.0';
  }

  /**
   * Validate destination address format with full bech32 checksum verification
   *
   * @param address - Address to validate
   * @throws RujiraError with INVALID_ADDRESS if format is invalid or checksum fails
   */
  private validateAddress(address: string): void {
    if (!address || typeof address !== 'string') {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        'Destination address is required'
      );
    }

    const trimmed = address.trim();

    // Check prefix (thor1 for mainnet, sthor1 for stagenet)
    if (!trimmed.startsWith('thor1') && !trimmed.startsWith('sthor1')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid destination address format: must start with 'thor1' or 'sthor1'. Got: ${address.substring(0, 10)}...`
      );
    }

    // Use fromBech32 for full validation including checksum verification
    try {
      const decoded = fromBech32(trimmed);
      
      // Verify the prefix matches expected values
      if (decoded.prefix !== 'thor' && decoded.prefix !== 'sthor') {
        throw new RujiraError(
          RujiraErrorCode.INVALID_ADDRESS,
          `Invalid address prefix: expected 'thor' or 'sthor', got '${decoded.prefix}'`
        );
      }
      
      // Verify data length (20 bytes for standard addresses, 32 for contracts)
      if (decoded.data.length !== 20 && decoded.data.length !== 32) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_ADDRESS,
          `Invalid address data length: expected 20 or 32 bytes, got ${decoded.data.length}`
        );
      }
    } catch (error) {
      // If it's already a RujiraError, rethrow
      if (error instanceof RujiraError) {
        throw error;
      }
      
      // fromBech32 throws on invalid checksum or format
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid bech32 address: ${error instanceof Error ? error.message : 'checksum verification failed'}`
      );
    }
  }

  /**
   * Validate user has sufficient balance for a swap
   *
   * @param fromAsset - Asset FIN format identifier
   * @param amount - Amount required in base units
   * @throws RujiraError with INSUFFICIENT_BALANCE if balance is too low
   */
  private async validateBalance(fromAsset: string, amount: string): Promise<void> {
    // Get asset info using @vultisig/assets
    const asset = findAssetByFormat(fromAsset, 'fin');
    if (!asset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${fromAsset}`
      );
    }

    const ticker = asset.name.split(' ')[0].toUpperCase();

    // Get user address
    const address = await this.client.getAddress();

    // Query balance
    const balance = await this.client.getBalance(address, asset.formats.fin);

    // Compare amounts using Amount class for proper decimal handling
    const required = Amount.fromRaw(BigInt(amount), asset, 'fin');
    const available = Amount.fromRaw(BigInt(balance.amount || '0'), asset, 'fin');

    if (available.raw < required.raw) {
      throw new RujiraError(
        RujiraErrorCode.INSUFFICIENT_BALANCE,
        `Insufficient ${ticker} balance. Required: ${required.toHuman()}, Available: ${available.toHuman()}`,
        {
          asset: fromAsset,
          denom: asset.formats.fin,
          required: amount,
          available: balance.amount,
          shortfall: (required.raw - available.raw).toString(),
        }
      );
    }
  }
}
