/**
 * Orderbook module for limit orders on Rujira DEX
 */

import { Coin } from '@cosmjs/proto-signing';
import Big from 'big.js';
import { findAssetByFormat } from '@vultisig/assets';

import type { RujiraClient } from '../client.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import type {
  LimitOrderParams,
  Order,
  OrderBook,
  OrderBookEntry,
  OrderResult,
  OrderSide,
  ContractSide,
  FinExecuteMsg,
  FinQueryMsg,
} from '../types.js';
import { toContractSide, fromContractSide } from '../types.js';

/**
 * Orderbook module for managing limit orders.
 *
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet', signer });
 * await client.connect();
 *
 * const book = await client.orderbook.getOrderBook('RUNE/BTC');
 * console.log('Best bid:', book.bids[0]?.price);
 * console.log('Best ask:', book.asks[0]?.price);
 *
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
   * Convenience alias used by older examples/tests.
   *
   * Accepts two asset identifiers (any format supported by @vultisig/assets)
   * and resolves the FIN contract key as "<baseDenom>/<quoteDenom>".
   */
  async getBook(baseAsset: string, quoteAsset: string, limit = 10): Promise<OrderBook> {
    const base = findAssetByFormat(baseAsset);
    const quote = findAssetByFormat(quoteAsset);

    const baseDenom = base?.formats?.fin;
    const quoteDenom = quote?.formats?.fin;

    if (!baseDenom || !quoteDenom) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset(s): ${baseAsset}, ${quoteAsset}`
      );
    }

    return this.getOrderBook(`${baseDenom}/${quoteDenom}`, limit);
  }

  /**
   * Get the order book for a trading pair.
   *
   * @param pairOrContract - Trading pair string or contract address
   * @param limit - Maximum entries per side (default: 50)
   */
  async getOrderBook(pairOrContract: string, limit = 50): Promise<OrderBook> {
    const contractAddress = await this.resolveContract(pairOrContract);

    const [response, config] = await Promise.all([
      this.client.getOrderBook(contractAddress, limit),
      this.getContractConfig(contractAddress),
    ]);

    const bids = this.transformBookEntries(response.base, 'desc');
    const asks = this.transformBookEntries(response.quote, 'asc');

    const bestBid = bids[0]?.price ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks[0]?.price ? parseFloat(asks[0].price) : 0;
    let spread = '0';

    if (bestBid > 0 && bestAsk > 0) {
      const midPrice = (bestAsk + bestBid) / 2;
      spread = (((bestAsk - bestBid) / midPrice) * 100).toFixed(4);
    }

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
   * Get contract configuration including pair info.
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
      return { base: '', quote: '' };
    }
  }

  /**
   * Convert denom to asset identifier.
   * @internal
   */
  private denomToAsset(denom: string): string {
    const asset = findAssetByFormat(denom);
    if (asset) {
      return asset.formats.thorchain;
    }

    const denomMap: Record<string, string> = {
      rune: 'THOR.RUNE',
      'btc-btc': 'BTC.BTC',
      'eth-eth': 'ETH.ETH',
      'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':
        'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7':
        'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
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

    if (denom.includes('-')) {
      const [chain, ...rest] = denom.split('-');
      return `${chain.toUpperCase()}.${rest.join('-').toUpperCase()}`;
    }

    return denom.toUpperCase();
  }

  /**
   * Place a limit order.
   */
  async placeOrder(params: LimitOrderParams): Promise<OrderResult> {
    this.validateOrderParams(params);

    const contractAddress = await this.resolveContract(
      typeof params.pair === 'string' ? params.pair : params.pair.contractAddress
    );

    const assetInfo = await this.getOfferAsset(params);

    if (!assetInfo) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        'Could not determine offer asset for order'
      );
    }

    // Convert SDK side to contract's Side enum format
    const contractSide = toContractSide(params.side);
    const orderTarget: [ContractSide, string, string | null] = [contractSide, params.price, params.amount];

    const msg: FinExecuteMsg = {
      order: [[orderTarget], null],
    };

    const funds: Coin[] = [
      {
        denom: assetInfo.denom,
        amount: this.calculateOfferAmount(params),
      },
    ];

    const result = await this.client.executeContract(contractAddress, msg, funds);

    const orderId = `${result.transactionHash}-0`;

    return {
      orderId,
      txHash: result.transactionHash,
      order: {
        orderId,
        owner: await this.client.getAddress(),
        pair:
          typeof params.pair === 'string'
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
   * Cancel an open order.
   */
  async cancelOrder(contractAddress: string, side: OrderSide, price: string): Promise<{ txHash: string }> {
    // Convert SDK side to contract's Side enum format
    const contractSide = toContractSide(side);
    const orderTarget: [ContractSide, string, string | null] = [contractSide, price, null];

    const msg: FinExecuteMsg = {
      order: [[orderTarget], null],
    };

    const result = await this.client.executeContract(contractAddress, msg, []);

    return { txHash: result.transactionHash };
  }

  /**
   * Get user's open orders.
   */
  async getOrders(
    contractAddress: string,
    owner?: string,
    side?: OrderSide,
    limit = 30,
    offset = 0
  ): Promise<Order[]> {
    const address = owner || (await this.client.getAddress());

    // Convert SDK side to contract side for query
    const contractSide = side ? toContractSide(side) : undefined;

    const query: FinQueryMsg = {
      orders: {
        owner: address,
        side: contractSide,
        offset,
        limit,
      },
    };

    const response = await this.client.queryContract<{
      orders: Array<{
        owner: string;
        side: ContractSide;
        price: string;
        rate: string;
        updated_at: string;
        offer: string;
        remaining: string;
        filled: string;
      }>;
    }>(contractAddress, query);

    return response.orders.map(
      (o: {
        owner: string;
        side: ContractSide;
        price: string;
        rate: string;
        updated_at: string;
        offer: string;
        remaining: string;
        filled: string;
      }) => {
        // Convert contract side back to SDK side
        const sdkSide = fromContractSide(o.side);
        return {
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
          side: sdkSide,
          price: o.price,
          amount: o.offer,
          filled: o.filled,
          remaining: o.remaining,
          status:
            BigInt(o.remaining) === 0n ? 'filled' : BigInt(o.filled) > 0n ? 'partial' : 'open',
          createdAt: parseInt(o.updated_at),
          updatedAt: parseInt(o.updated_at),
        };
      }
    );
  }

  /**
   * Get a specific order.
   */
  async getOrder(
    contractAddress: string,
    owner: string,
    side: OrderSide,
    price: string
  ): Promise<Order | null> {
    // Convert SDK side to contract side for query
    const contractSide = toContractSide(side);

    const query: FinQueryMsg = {
      order: [owner, contractSide, price],
    };

    try {
      const response = await this.client.queryContract<{
        owner: string;
        side: ContractSide;
        price: string;
        rate: string;
        updated_at: string;
        offer: string;
        remaining: string;
        filled: string;
      }>(contractAddress, query);

      // Convert contract side back to SDK side
      const sdkSide = fromContractSide(response.side);

      return {
        orderId: `${owner}-${response.side}-${price}`,
        owner: response.owner,
        pair: {
          base: '',
          quote: '',
          contractAddress,
          tick: '0',
          takerFee: '0',
          makerFee: '0',
        },
        side: sdkSide,
        price: response.price,
        amount: response.offer,
        filled: response.filled,
        remaining: response.remaining,
        status:
          BigInt(response.remaining) === 0n
            ? 'filled'
            : BigInt(response.filled) > 0n
              ? 'partial'
              : 'open',
        createdAt: parseInt(response.updated_at),
        updatedAt: parseInt(response.updated_at),
      };
    } catch {
      return null;
    }
  }

  private async resolveContract(pairOrContract: string): Promise<string> {
    if (pairOrContract.startsWith('thor1')) {
      return pairOrContract;
    }

    const knownContracts = this.client.config.contracts.finContracts;
    if (knownContracts[pairOrContract]) {
      return knownContracts[pairOrContract];
    }

    throw new RujiraError(RujiraErrorCode.INVALID_PAIR, `Unknown trading pair: ${pairOrContract}`);
  }

  /**
   * Uses string-based decimal arithmetic to avoid floating-point precision loss.
   */
  private transformBookEntries(
    entries: Array<{ price: string; total: string }>,
    sortOrder: 'asc' | 'desc'
  ): OrderBookEntry[] {
    const transformed = entries.map((e) => {
      const price = Big(e.price);
      const amount = Big(e.total);

      return {
        price: e.price,
        amount: e.total,
        total: price.mul(amount).toFixed(8),
      };
    });

    return transformed.sort((a, b) => {
      const pA = Big(a.price);
      const pB = Big(b.price);
      return sortOrder === 'asc' ? pA.cmp(pB) : pB.cmp(pA);
    });
  }

  private validateOrderParams(params: LimitOrderParams): void {
    if (!params.price || parseFloat(params.price) <= 0) {
      throw new RujiraError(RujiraErrorCode.INVALID_PRICE, 'Order price must be positive');
    }

    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Order amount must be positive');
    }

    if (!['buy', 'sell'].includes(params.side)) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Order side must be "buy" or "sell"');
    }
  }

  private async getOfferAsset(
    params: LimitOrderParams
  ): Promise<{ denom: string; decimals: number } | undefined> {
    const getAssetInfo = (assetId: string): { denom: string; decimals: number } | undefined => {
      const asset = findAssetByFormat(assetId);
      if (!asset?.formats?.fin) return undefined;
      return { denom: asset.formats.fin, decimals: asset.decimals?.fin ?? 8 };
    };

    if (typeof params.pair !== 'string' && params.pair.base && params.pair.quote) {
      const assetId = params.side === 'buy' ? params.pair.quote : params.pair.base;
      return getAssetInfo(assetId);
    }

    const contractAddress = await this.resolveContract(
      typeof params.pair === 'string' ? params.pair : params.pair.contractAddress
    );

    const config = await this.getContractConfig(contractAddress);

    if (params.side === 'buy') {
      return config.quote ? getAssetInfo(config.quote) : getAssetInfo('THOR.RUNE');
    }

    return config.base ? getAssetInfo(config.base) : undefined;
  }

  private calculateOfferAmount(params: LimitOrderParams): string {
    if (params.side === 'buy') {
      const amount = Big(params.amount);
      const price = Big(params.price);
      return amount.mul(price).toFixed(0, 0);
    }

    return params.amount;
  }
}
