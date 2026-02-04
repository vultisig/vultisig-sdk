import { fromBech32 } from '@cosmjs/encoding';
import { Coin } from '@cosmjs/proto-signing';
import { Amount, findAssetByFormat } from '@vultisig/assets';
import Big from 'big.js';

import { EASY_ROUTES, type EasyRouteName, type EasySwapRequest } from '../easy-routes.js';
import type { RujiraClient } from '../client.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import type {
  FinExecuteMsg,
  OrderBook,
  QuoteParams,
  SwapOptions,
  SwapQuote,
  SwapResult,
} from '../types.js';
import { QuoteCache, type QuoteCacheOptions } from '../utils/cache.js';
import { calculateMinReturn, generateQuoteId } from '../utils/format.js';

export interface RujiraSwapOptions {
  cache?: QuoteCacheOptions | false;
  quoteExpiryBufferMs?: number;
  quoteTtlMs?: number;
  batchConcurrency?: number;
  /** Minimum swap amount in base units. Amounts at or below this are rejected. Default: 0 (contract enforces). */
  dustThreshold?: string;
}

export class RujiraSwap {
  private readonly quoteCache: QuoteCache<SwapQuote> | null;
  private readonly quoteExpiryBufferMs: number;
  private readonly quoteTtlMs: number;
  private readonly batchConcurrency: number;
  private readonly dustThreshold: bigint;

  constructor(
    private readonly client: RujiraClient,
    options: RujiraSwapOptions = {}
  ) {
    this.quoteCache = options.cache === false ? null : new QuoteCache<SwapQuote>(options.cache);
    // MPC (GG20/DKLS) signing takes 30-60s. Buffer must exceed signing time
    // to prevent quote expiry mid-sign. TTL must exceed buffer.
    this.quoteExpiryBufferMs = options.quoteExpiryBufferMs ?? 60000;
    this.quoteTtlMs = options.quoteTtlMs ?? 120000;
    this.batchConcurrency = options.batchConcurrency ?? 3;
    this.dustThreshold = BigInt(options.dustThreshold ?? '0');
  }

  clearCache(): void {
    this.quoteCache?.clear();
  }

  getCacheStats(): { size: number; maxSize: number; ttlMs: number } | null {
    return this.quoteCache?.stats() ?? null;
  }

  async getQuote(
    params: QuoteParams,
    options: { skipCache?: boolean; maxStalenessMs?: number } | boolean = false
  ): Promise<SwapQuote> {
    const skipCache = typeof options === 'boolean' ? options : options.skipCache ?? false;
    const maxStalenessMs = typeof options === 'boolean' ? undefined : options.maxStalenessMs;

    this.validateQuoteParams(params);

    if (params.destination) {
      this.validateAddress(params.destination);
    }

    if (!skipCache && this.quoteCache) {
      const cached = this.quoteCache.get(params.fromAsset, params.toAsset, params.amount);
      if (cached) {
        if (Date.now() >= cached.expiresAt) {
          // expired; fall through to fetch
        } else if (maxStalenessMs !== undefined && cached.cachedAt) {
          const age = Date.now() - cached.cachedAt;
          if (age <= maxStalenessMs) {
            return this.recomputeMinimumOutput(cached, params.slippageBps);
          }
        } else {
          const age = cached.cachedAt ? Date.now() - cached.cachedAt : 0;
          if (age > 5000) {
            return this.recomputeMinimumOutput(
              {
                ...cached,
                warning:
                  cached.warning ??
                  `Quote is ${Math.round(age / 1000)}s old. Consider refreshing for volatile markets.`,
              },
              params.slippageBps
            );
          }
          return this.recomputeMinimumOutput(cached, params.slippageBps);
        }
      }
    }

    const fromAsset = findAssetByFormat(params.fromAsset);
    const toAsset = findAssetByFormat(params.toAsset);

    if (!fromAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${params.fromAsset}`);
    }

    if (!toAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${params.toAsset}`);
    }

    const contractAddress = await this.findContract(params.fromAsset, params.toAsset);

    const [simulation, orderbook] = await Promise.all([
      this.client.simulateSwap(contractAddress, fromAsset.formats.fin, params.amount),
      this.client.orderbook.getOrderBook(contractAddress).catch(() => null),
    ]);

    const slippageBps = params.slippageBps ?? this.client.config.defaultSlippageBps;
    const minimumOutput = calculateMinReturn(simulation.returned, slippageBps);

    const inputAmount = Big(params.amount);
    const outputAmount = Big(simulation.returned);

    // input * 1e8 / output
    const rate = outputAmount.gt(0)
      ? inputAmount.mul(100000000).div(outputAmount).toFixed(0, 0) // round down
      : '0';

    const priceImpact = this.calculatePriceImpact(params.amount, simulation.returned, orderbook);

    const priceImpactEstimated =
      !orderbook || !orderbook.bids[0]?.price || !orderbook.asks[0]?.price;

    const quote: SwapQuote = {
      params,
      expectedOutput: simulation.returned,
      minimumOutput,
      rate,
      priceImpact,
      fees: {
        network: '0',
        protocol: simulation.fee,
        affiliate: '0',
        total: simulation.fee,
      },
      contractAddress,
      expiresAt: Date.now() + this.quoteTtlMs,
      quoteId: generateQuoteId(),
      cachedAt: Date.now(),
      warning:
        priceImpactEstimated || priceImpact === 'unknown'
          ? 'Price impact is estimated or unknown - orderbook data unavailable. Actual slippage may differ.'
          : undefined,
    };

    this.quoteCache?.set(params.fromAsset, params.toAsset, params.amount, quote);

    return quote;
  }

  async execute(quote: SwapQuote, options: SwapOptions = {}): Promise<SwapResult> {
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

    if (!options.skipBalanceValidation) {
      await this.validateBalance(quote.params.fromAsset, quote.params.amount);
    }

    const fromAsset = findAssetByFormat(quote.params.fromAsset);
    if (!fromAsset) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${quote.params.fromAsset}`
      );
    }

    const slippageBps =
      options.slippageBps ?? quote.params.slippageBps ?? this.client.config.defaultSlippageBps;
    const minReturn = calculateMinReturn(quote.expectedOutput, slippageBps);

    const swapMsg: FinExecuteMsg = {
      swap: {
        min: {
          min_return: minReturn,
          to: quote.params.destination,
        },
      },
    };

    const funds: Coin[] = [
      {
        denom: fromAsset.formats.fin,
        amount: quote.params.amount,
      },
    ];

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

  async executeSwap(params: QuoteParams, options: SwapOptions = {}): Promise<SwapResult> {
    const quote = await this.getQuote(params);
    return this.execute(quote, options);
  }

  async buildTransaction(params: QuoteParams): Promise<{
    contractAddress: string;
    msg: FinExecuteMsg;
    funds: Coin[];
  }> {
    const quote = await this.getQuote(params);

    const fromAsset = findAssetByFormat(params.fromAsset);
    if (!fromAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${params.fromAsset}`);
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
        },
      },
    };

    const funds: Coin[] = [
      {
        denom: fromAsset.formats.fin,
        amount: params.amount,
      },
    ];

    return {
      contractAddress: quote.contractAddress,
      msg,
      funds,
    };
  }

  async buildL1Memo(params: QuoteParams): Promise<string> {
    const { contractAddress, msg } = await this.buildTransaction(params);
    const msgBase64 = Buffer.from(JSON.stringify(msg)).toString('base64');
    return `x:${contractAddress}:${msgBase64}`;
  }

  async easySwap(request: EasySwapRequest): Promise<SwapResult> {
    this.validateAddress(request.destination);

    let fromAsset: string;
    let toAsset: string;

    if (request.route) {
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
      fromAsset = request.from;
      toAsset = request.to;
    } else {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PAIR,
        'EasySwapRequest must specify either route or both from and to'
      );
    }

    await this.validateBalance(fromAsset, request.amount);

    const slippageBps =
      request.maxSlippagePercent !== undefined
        ? Math.round(request.maxSlippagePercent * 100)
        : undefined;

    const quoteParams: QuoteParams = {
      fromAsset,
      toAsset,
      amount: request.amount,
      destination: request.destination,
      slippageBps,
    };

    const quote = await this.getQuote(quoteParams);
    return this.execute(quote, { skipBalanceValidation: true });
  }

  async batchGetQuotes(
    routes: EasyRouteName[],
    amount: string,
    destination?: string
  ): Promise<Map<EasyRouteName, SwapQuote | null>> {
    const results: Array<{ routeName: EasyRouteName; quote: SwapQuote | null }> = [];

    for (let i = 0; i < routes.length; i += this.batchConcurrency) {
      const batch = routes.slice(i, i + this.batchConcurrency);
      const batchResults = await Promise.all(
        batch.map(async (routeName) => {
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
            return { routeName, quote: null };
          }
        })
      );
      results.push(...batchResults);
    }

    const resultMap = new Map<EasyRouteName, SwapQuote | null>();
    for (const { routeName, quote } of results) {
      resultMap.set(routeName, quote);
    }

    return resultMap;
  }

  async getAllRouteQuotes(
    amount: string,
    destination?: string
  ): Promise<Map<EasyRouteName, SwapQuote | null>> {
    const allRoutes = Object.keys(EASY_ROUTES) as EasyRouteName[];
    return this.batchGetQuotes(allRoutes, amount, destination);
  }

  /**
   * Recompute minimumOutput from cached expectedOutput using the caller's slippage.
   * Cache stores raw simulation data; slippage-dependent values are derived per-request.
   */
  private recomputeMinimumOutput(quote: SwapQuote, slippageBps?: number): SwapQuote {
    const effectiveSlippage = slippageBps ?? quote.params.slippageBps ?? this.client.config.defaultSlippageBps;
    const minimumOutput = calculateMinReturn(quote.expectedOutput, effectiveSlippage);
    if (minimumOutput === quote.minimumOutput) return quote;
    return { ...quote, minimumOutput, params: { ...quote.params, slippageBps: effectiveSlippage } };
  }

  private async findContract(fromAsset: string, toAsset: string): Promise<string> {
    const pairKey = `${fromAsset}/${toAsset}`;
    const reversePairKey = `${toAsset}/${fromAsset}`;

    const knownContracts = this.client.config.contracts.finContracts;

    if (knownContracts[pairKey]) {
      return knownContracts[pairKey];
    }

    if (knownContracts[reversePairKey]) {
      return knownContracts[reversePairKey];
    }

    let address = await this.client.discovery.getContractAddress(fromAsset, toAsset);

    if (!address) {
      address = await this.client.discovery.getContractAddress(toAsset, fromAsset);
    }

    if (address) {
      this.client.config.contracts.finContracts[pairKey] = address;
      this.client.persistFinContracts().catch(() => undefined);
      return address;
    }

    throw new RujiraError(
      RujiraErrorCode.INVALID_PAIR,
      `No FIN contract found for pair: ${fromAsset}/${toAsset}. ` +
        'Market may not exist on Rujira or discovery failed.'
    );
  }

  private validateQuoteParams(params: QuoteParams): void {
    if (!params.fromAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, 'fromAsset is required');
    }

    if (!params.toAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, 'toAsset is required');
    }

    if (params.fromAsset === params.toAsset) {
      throw new RujiraError(RujiraErrorCode.INVALID_PAIR, 'Cannot swap asset to itself');
    }

    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'amount must be a positive number');
    }

    if (this.dustThreshold > 0n && BigInt(params.amount) <= this.dustThreshold) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        `Swap amount ${params.amount} is at or below dust threshold (${this.dustThreshold}). ` +
          `Minimum swap amount: ${(this.dustThreshold + 1n).toString()}`
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

  private calculatePriceImpact(
    inputAmount: string,
    outputAmount: string,
    orderbook: OrderBook | null
  ): string {
    if (!orderbook) {
      return this.estimatePriceImpactWithoutOrderbook(inputAmount);
    }

    const bestBid = orderbook.bids[0]?.price;
    const bestAsk = orderbook.asks[0]?.price;

    if (!bestBid || !bestAsk) {
      return this.estimatePriceImpactWithoutOrderbook(inputAmount);
    }

    const bidPrice = Big(bestBid);
    const askPrice = Big(bestAsk);

    if (bidPrice.lte(0) || askPrice.lte(0)) {
      return '0';
    }

    const midPrice = bidPrice.plus(askPrice).div(2);

    const input = Big(inputAmount);
    const output = Big(outputAmount);

    if (input.lte(0) || output.lte(0)) {
      return '0';
    }

    // execution_price = output / input
    const executionPrice = output.div(input);

    // impact = abs((execution_price - midPrice) / midPrice) * 100
    const impact = executionPrice.minus(midPrice).div(midPrice).abs().mul(100);

    if (impact.gt(50)) {
      return '50.00';
    }

    return impact.toFixed(4);
  }

  private estimatePriceImpactWithoutOrderbook(inputAmount: string): string {
    const amount = BigInt(inputAmount);

    const largeSwapThreshold = BigInt('1000000000000');

    if (amount >= largeSwapThreshold) {
      return 'unknown';
    }

    const mediumSwapThreshold = BigInt('100000000000');

    if (amount >= mediumSwapThreshold) {
      return '2.0-5.0';
    }

    return '1.0-3.0';
  }

  private validateAddress(address: string): void {
    if (!address || typeof address !== 'string') {
      throw new RujiraError(RujiraErrorCode.INVALID_ADDRESS, 'Destination address is required');
    }

    const trimmed = address.trim();

    if (!trimmed.startsWith('thor1')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid destination address format: must start with 'thor1'. Got: ${address.substring(0, 10)}...`
      );
    }

    try {
      const decoded = fromBech32(trimmed);

      if (decoded.prefix !== 'thor') {
        throw new RujiraError(
          RujiraErrorCode.INVALID_ADDRESS,
          `Invalid address prefix: expected 'thor', got '${decoded.prefix}'`
        );
      }

      if (decoded.data.length !== 20 && decoded.data.length !== 32) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_ADDRESS,
          `Invalid address data length: expected 20 or 32 bytes, got ${decoded.data.length}`
        );
      }
    } catch (error) {
      if (error instanceof RujiraError) {
        throw error;
      }

      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid bech32 address: ${error instanceof Error ? error.message : 'checksum verification failed'}`
      );
    }
  }

  private async validateBalance(fromAsset: string, amount: string): Promise<void> {
    const asset = findAssetByFormat(fromAsset);
    if (!asset) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${fromAsset}`);
    }

    const ticker = asset.name.split(' ')[0].toUpperCase();

    const address = await this.client.getAddress();

    const balance = await this.client.getBalance(address, asset.formats.fin);

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
