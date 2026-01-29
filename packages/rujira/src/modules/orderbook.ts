/**
 * Orderbook module for limit orders on Rujira DEX
 * @module modules/orderbook
 */

import { Coin } from '@cosmjs/proto-signing';
import type { RujiraClient } from '../client';
import { RujiraError, RujiraErrorCode } from '../errors';
import { findAssetByFormat } from '@vultisig/assets';
import type {
  TradingPair,
  LimitOrderParams,
  Order,
  OrderResult,
  OrderBook,
  OrderBookEntry,
  OrderSide,
  FinExecuteMsg,
  FinQueryMsg,
} from '../types';

/**
 * Orderbook module for managing limit orders
 * 
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet', signer });
 * await client.connect();
 * 
 * // Get order book
 * const book = await client.orderbook.getOrderBook('RUNE/BTC');
 * console.log('Best bid:', book.bids[0]?.price);
 * console.log('Best ask:', book.asks[0]?.price);
 * 
 * // Place a limit order
 * const order = await client.orderbook.placeOrder({
 *   pair: 'RUNE/BTC',
 *   side: 'buy',
 *   price: '0.000025',
 *   amount: '100000000',
 * });
 * ```
 */
export class RujiraOrderbook {
  constructor(private readonly client: RujiraClient) {}

  /**
   * Get the order book for a trading pair
   *
   * @param pairOrContract - Trading pair string or contract address
   * @param limit - Maximum entries per side (default: 50)
   */
  async getOrderBook(
    pairOrContract: string,
    limit = 50
  ): Promise<OrderBook> {
    const contractAddress = await this.resolveContract(pairOrContract);

    // Fetch order book and config in parallel
    const [response, config] = await Promise.all([
      this.client.getOrderBook(contractAddress, limit),
      this.getContractConfig(contractAddress),
    ]);

    // Transform response
    const bids = this.transformBookEntries(response.base, 'desc');
    const asks = this.transformBookEntries(response.quote, 'asc');

    // Calculate spread: (best_ask - best_bid) / mid_price * 100
    const bestBid = bids[0]?.price ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks[0]?.price ? parseFloat(asks[0].price) : 0;
    let spread = '0';
    if (bestBid > 0 && bestAsk > 0) {
      const midPrice = (bestAsk + bestBid) / 2;
      spread = (((bestAsk - bestBid) / midPrice) * 100).toFixed(4);
    }

    // Get last price from config or best bid/ask as fallback
    const lastPrice = config.lastPrice || bids[0]?.price || asks[0]?.price || '0';

    return {
      pair: {
        base: config.base,
        quote: config.quote,
        contractAddress,
        tick: config.tick || '0',
        takerFee: config.takerFee || '0.0015',
        makerFee: config.makerFee || '0.00075',
      },
      bids,
      asks,
      spread,
      lastPrice,
      timestamp: Date.now(),
    };
  }

  /**
   * Get contract configuration including pair info
   * @internal
   */
  private async getContractConfig(contractAddress: string): Promise<{
    base: string;
    quote: string;
    tick?: string;
    takerFee?: string;
    makerFee?: string;
    lastPrice?: string;
  }> {
    try {
      const query: FinQueryMsg = { config: {} };
      const response = await this.client.queryContract<{
        denoms: { base: string; quote: string };
        tick?: string;
        fee?: { taker: string; maker: string };
        last_price?: string;
      }>(contractAddress, query);

      // Convert denoms to asset format (e.g., "rune" -> "THOR.RUNE")
      const base = this.denomToAsset(response.denoms.base);
      const quote = this.denomToAsset(response.denoms.quote);

      return {
        base,
        quote,
        tick: response.tick,
        takerFee: response.fee?.taker,
        makerFee: response.fee?.maker,
        lastPrice: response.last_price,
      };
    } catch {
      // If config query fails, return empty values
      return { base: '', quote: '' };
    }
  }

  /**
   * Convert denom to asset identifier
   * @internal
   */
  private denomToAsset(denom: string): string {
    // Try to look up in known assets first
    const asset = findAssetByFormat(denom);
    if (asset) {
      return asset.formats.thorchain;
    }

    // Common denom mappings (fallback)
    const denomMap: Record<string, string> = {
      'rune': 'THOR.RUNE',
      'btc-btc': 'BTC.BTC',
      'eth-eth': 'ETH.ETH',
      'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7': 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
      'gaia-atom': 'GAIA.ATOM',
      'avax-avax': 'AVAX.AVAX',
      'bsc-bnb': 'BSC.BNB',
      'doge-doge': 'DOGE.DOGE',
      'ltc-ltc': 'LTC.LTC',
      'bch-bch': 'BCH.BCH',
      'thor.ruji': 'THOR.RUJI',
      'thor.tcy': 'THOR.TCY',
    };

    const normalized = denom.toLowerCase();
    if (denomMap[normalized]) {
      return denomMap[normalized];
    }

    // Try to convert format: "chain-symbol" -> "CHAIN.SYMBOL"
    if (denom.includes('-')) {
      const [chain, ...rest] = denom.split('-');
      return `${chain.toUpperCase()}.${rest.join('-').toUpperCase()}`;
    }

    return denom.toUpperCase();
  }

  /**
   * Place a limit order
   * 
   * @param params - Order parameters
   * @returns Order result
   */
  async placeOrder(params: LimitOrderParams): Promise<OrderResult> {
    this.validateOrderParams(params);

    const contractAddress = await this.resolveContract(
      typeof params.pair === 'string' ? params.pair : params.pair.contractAddress
    );

    // Get asset info for the side we're offering
    // For buy orders, we offer quote asset; for sell orders, we offer base asset
    const assetInfo = await this.getOfferAsset(params);
    
    if (!assetInfo) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        'Could not determine offer asset for order'
      );
    }

    // Build order target
    // Format: [Side, Price, Amount]
    const orderTarget: [OrderSide, string, string | null] = [
      params.side,
      params.price,
      params.amount,
    ];

    // Build execute message
    const msg: FinExecuteMsg = {
      order: [[orderTarget], null]
    };

    // Calculate funds to send
    const funds: Coin[] = [{
      denom: assetInfo.denom,
      amount: this.calculateOfferAmount(params),
    }];

    // Execute
    const result = await this.client.executeContract(
      contractAddress,
      msg,
      funds
    );

    // Build order ID (simplified - would come from events in real impl)
    const orderId = `${result.transactionHash}-0`;

    return {
      orderId,
      txHash: result.transactionHash,
      order: {
        orderId,
        owner: await this.client.getAddress(),
        pair: typeof params.pair === 'string' 
          ? { base: '', quote: '', contractAddress, tick: '0', takerFee: '0', makerFee: '0' }
          : params.pair,
        side: params.side,
        price: params.price,
        amount: params.amount,
        filled: '0',
        remaining: params.amount,
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
  }

  /**
   * Cancel an open order
   * 
   * @param contractAddress - FIN contract address
   * @param side - Order side
   * @param price - Order price
   */
  async cancelOrder(
    contractAddress: string,
    side: OrderSide,
    price: string
  ): Promise<{ txHash: string }> {
    // To cancel, we set the amount to null (withdraw all)
    const orderTarget: [OrderSide, string, string | null] = [
      side,
      price,
      null, // null = withdraw
    ];

    const msg: FinExecuteMsg = {
      order: [[orderTarget], null]
    };

    const result = await this.client.executeContract(
      contractAddress,
      msg,
      [] // No funds for cancel
    );

    return { txHash: result.transactionHash };
  }

  /**
   * Get user's open orders
   * 
   * @param contractAddress - FIN contract address
   * @param owner - Owner address (defaults to connected wallet)
   * @param side - Filter by side (optional)
   */
  async getOrders(
    contractAddress: string,
    owner?: string,
    side?: OrderSide,
    limit = 30,
    offset = 0
  ): Promise<Order[]> {
    const address = owner || await this.client.getAddress();

    const query: FinQueryMsg = {
      orders: {
        owner: address,
        side,
        offset,
        limit,
      }
    };

    const response = await this.client.queryContract<{
      orders: Array<{
        owner: string;
        side: OrderSide;
        price: string;
        rate: string;
        updated_at: string;
        offer: string;
        remaining: string;
        filled: string;
      }>;
    }>(contractAddress, query);

    return response.orders.map((o: {
      owner: string;
      side: OrderSide;
      price: string;
      rate: string;
      updated_at: string;
      offer: string;
      remaining: string;
      filled: string;
    }) => ({
      orderId: `${address}-${o.side}-${o.price}`,
      owner: o.owner,
      pair: {
        base: '',
        quote: '',
        contractAddress,
        tick: '0',
        takerFee: '0',
        makerFee: '0',
      },
      side: o.side,
      price: o.price,
      amount: o.offer,
      filled: o.filled,
      remaining: o.remaining,
      status: BigInt(o.remaining) === 0n ? 'filled' : 
              BigInt(o.filled) > 0n ? 'partial' : 'open',
      createdAt: parseInt(o.updated_at),
      updatedAt: parseInt(o.updated_at),
    }));
  }

  /**
   * Get a specific order
   * 
   * @param contractAddress - FIN contract address
   * @param owner - Owner address
   * @param side - Order side
   * @param price - Order price
   */
  async getOrder(
    contractAddress: string,
    owner: string,
    side: OrderSide,
    price: string
  ): Promise<Order | null> {
    const query: FinQueryMsg = {
      order: [owner, side, price]
    };

    try {
      const response = await this.client.queryContract<{
        owner: string;
        side: OrderSide;
        price: string;
        rate: string;
        updated_at: string;
        offer: string;
        remaining: string;
        filled: string;
      }>(contractAddress, query);

      return {
        orderId: `${owner}-${side}-${price}`,
        owner: response.owner,
        pair: {
          base: '',
          quote: '',
          contractAddress,
          tick: '0',
          takerFee: '0',
          makerFee: '0',
        },
        side: response.side,
        price: response.price,
        amount: response.offer,
        filled: response.filled,
        remaining: response.remaining,
        status: BigInt(response.remaining) === 0n ? 'filled' :
                BigInt(response.filled) > 0n ? 'partial' : 'open',
        createdAt: parseInt(response.updated_at),
        updatedAt: parseInt(response.updated_at),
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // INTERNAL
  // ============================================================================

  /**
   * Resolve contract address from pair string or address
   */
  private async resolveContract(pairOrContract: string): Promise<string> {
    // If it looks like an address, return it
    if (pairOrContract.startsWith('thor1') || pairOrContract.startsWith('sthor1')) {
      return pairOrContract;
    }

    // Look up in known contracts
    const knownContracts = this.client.config.contracts.finContracts;
    if (knownContracts[pairOrContract]) {
      return knownContracts[pairOrContract];
    }

    throw new RujiraError(
      RujiraErrorCode.INVALID_PAIR,
      `Unknown trading pair: ${pairOrContract}`
    );
  }

  /**
   * Transform book entries from contract response
   * Uses string-based decimal arithmetic to avoid floating-point precision loss
   */
  private transformBookEntries(
    entries: Array<{ price: string; total: string }>,
    sortOrder: 'asc' | 'desc'
  ): OrderBookEntry[] {
    const transformed = entries.map((e) => {
      // Calculate total value: price * amount using string-based decimal math
      const total = this.multiplyDecimals(e.price, e.total);

      return {
        price: e.price,
        amount: e.total,
        total,
      };
    });

    return transformed.sort((a, b) => {
      // Use string comparison for decimal sorting to avoid precision loss
      const cmp = this.compareDecimals(a.price, b.price);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }

  /**
   * Multiply two decimal strings without floating-point precision loss
   * Returns integer string (truncated, not rounded)
   */
  private multiplyDecimals(a: string, b: string): string {
    // Parse decimal parts
    const [aInt, aFrac = ''] = a.split('.');
    const [bInt, bFrac = ''] = b.split('.');
    
    // Convert to integers by removing decimal points
    const aScaled = BigInt(aInt + aFrac);
    const bScaled = BigInt(bInt + bFrac);
    
    // Total decimal places = sum of both decimal place counts
    const totalDecimals = aFrac.length + bFrac.length;
    
    // Multiply scaled integers
    const product = aScaled * bScaled;
    
    // Truncate to integer (remove all decimal places)
    if (totalDecimals === 0) {
      return product.toString();
    }
    
    const divisor = BigInt(10) ** BigInt(totalDecimals);
    return (product / divisor).toString();
  }

  /**
   * Compare two decimal strings
   * Returns: -1 if a < b, 0 if equal, 1 if a > b
   */
  private compareDecimals(a: string, b: string): number {
    // Normalize to same decimal places for comparison
    const [aInt, aFrac = ''] = a.split('.');
    const [bInt, bFrac = ''] = b.split('.');
    
    // Pad fractions to same length
    const maxFracLen = Math.max(aFrac.length, bFrac.length);
    const aPadded = aFrac.padEnd(maxFracLen, '0');
    const bPadded = bFrac.padEnd(maxFracLen, '0');
    
    // Convert to BigInt for comparison
    const aScaled = BigInt(aInt + aPadded);
    const bScaled = BigInt(bInt + bPadded);
    
    if (aScaled < bScaled) return -1;
    if (aScaled > bScaled) return 1;
    return 0;
  }

  /**
   * Validate order parameters
   */
  private validateOrderParams(params: LimitOrderParams): void {
    if (!params.price || parseFloat(params.price) <= 0) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PRICE,
        'Order price must be positive'
      );
    }

    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'Order amount must be positive'
      );
    }

    if (!['buy', 'sell'].includes(params.side)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'Order side must be "buy" or "sell"'
      );
    }
  }

  /**
   * Get the asset info for the offer side of an order
   * 
   * For buy orders: we offer the quote asset (typically RUNE)
   * For sell orders: we offer the base asset (queried from contract config)
   * 
   * @param params - Order parameters including pair and side
   * @returns Asset info with denom and decimals, or undefined if not found
   */
  private async getOfferAsset(
    params: LimitOrderParams
  ): Promise<{ denom: string; decimals: number } | undefined> {
    // For limit orders, we need to determine which asset we're offering
    // Buy order = offer quote asset (typically RUNE)
    // Sell order = offer base asset (the asset being sold)

    // Helper to get asset info from @vultisig/assets (single-arg signature)
    const getAssetInfo = (assetId: string): { denom: string; decimals: number } | undefined => {
      const asset = findAssetByFormat(assetId);
      if (!asset?.formats?.fin) return undefined;
      return { 
        denom: asset.formats.fin, 
        decimals: asset.decimals?.fin ?? 8 
      };
    };

    // If pair is a TradingPair object with base/quote info, use it directly
    if (typeof params.pair !== 'string' && params.pair.base && params.pair.quote) {
      const assetId = params.side === 'buy' ? params.pair.quote : params.pair.base;
      return getAssetInfo(assetId);
    }

    // For string pair or pair without asset info, query the contract
    const contractAddress = await this.resolveContract(
      typeof params.pair === 'string' ? params.pair : params.pair.contractAddress
    );
    
    const config = await this.getContractConfig(contractAddress);
    
    if (params.side === 'buy') {
      // Buy orders offer the quote asset
      return config.quote ? getAssetInfo(config.quote) : getAssetInfo('THOR.RUNE');
    } else {
      // Sell orders offer the base asset
      if (config.base) {
        return getAssetInfo(config.base);
      }
      // Fallback: if we can't determine base asset, return undefined
      return undefined;
    }
  }

  /**
   * Calculate offer amount for order
   */
  private calculateOfferAmount(params: LimitOrderParams): string {
    if (params.side === 'buy') {
      // For buy, offer = amount * price
      const amount = BigInt(params.amount);
      const price = BigInt(Math.floor(parseFloat(params.price) * 1e8));
      return ((amount * price) / BigInt(1e8)).toString();
    }
    // For sell, offer = amount
    return params.amount;
  }
}
