/**
 * Core type definitions for Rujira SDK
 * @module types
 */

// ============================================================================
// ASSET TYPES
// ============================================================================

/**
 * Rujira asset representation
 * Format: "CHAIN.SYMBOL" (e.g., "THOR.RUNE", "BTC.BTC")
 */
export interface RujiraAsset {
  /** Full asset identifier (e.g., "THOR.RUNE") */
  asset: string;
  /** Chain identifier */
  chain: string;
  /** Symbol on the chain */
  symbol: string;
  /** Display ticker */
  ticker: string;
  /** Decimal places */
  decimals: number;
  /** Asset type */
  type: 'native' | 'secured' | 'synthetic';
  /** Native denom on THORChain */
  denom: string;
  /** Contract address (for CW20 tokens) */
  contractAddress?: string;
}

/**
 * Trading pair on Rujira DEX
 */
export interface TradingPair {
  /** Base asset (e.g., "BTC.BTC") */
  base: string;
  /** Quote asset (e.g., "THOR.RUNE") */
  quote: string;
  /** FIN contract address for this pair */
  contractAddress: string;
  /** Tick size for price precision */
  tick: string;
  /** Taker fee (e.g., "0.0015" for 0.15%) */
  takerFee: string;
  /** Maker fee (e.g., "0.00075" for 0.075%) */
  makerFee: string;
}

// ============================================================================
// PRICE IMPACT TYPES
// ============================================================================

/**
 * Structured price impact information
 */
export interface PriceImpact {
  /** Exact price impact percentage (null if cannot be calculated) */
  value: number | null;
  /** Whether this is an estimate (true if orderbook data unavailable) */
  estimated: boolean;
  /** Estimated range [min, max] when exact value unavailable */
  range?: [number, number];
  /** Human-readable display string */
  display: string;
}

// ============================================================================
// QUOTE TYPES
// ============================================================================

/**
 * Parameters for requesting a swap quote
 */
export interface QuoteParams {
  /** Source asset (e.g., "THOR.RUNE") */
  fromAsset: string;
  /** Destination asset (e.g., "BTC.BTC") */
  toAsset: string;
  /** Amount in base units (8 decimals) */
  amount: string;
  /** Slippage tolerance in basis points (default: 100 = 1%) */
  slippageBps?: number;
  /** Destination address (optional, defaults to sender) */
  destination?: string;
  /** Affiliate address for fee sharing */
  affiliate?: string;
  /** Affiliate fee in basis points */
  affiliateBps?: number;
}

/**
 * Swap quote response
 */
export interface SwapQuote {
  /** Quote parameters */
  params: QuoteParams;
  /** Expected output amount in base units */
  expectedOutput: string;
  /** Minimum output after slippage */
  minimumOutput: string;
  /** Exchange rate (output per input) */
  rate: string;
  /** Price impact percentage */
  priceImpact: string;
  /** Estimated fees */
  fees: {
    /** Network/gas fee */
    network: string;
    /** Protocol fee */
    protocol: string;
    /** Affiliate fee (if applicable) */
    affiliate: string;
    /** Total fees */
    total: string;
  };
  /** FIN contract to execute on */
  contractAddress: string;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Unique quote ID for tracking */
  quoteId: string;
  /** When this quote was created/cached (for staleness checks) */
  cachedAt?: number;
  /** Warning message if any (e.g., stale cache, estimated price impact) */
  warning?: string;
}

// ============================================================================
// SWAP TYPES
// ============================================================================

/**
 * Swap execution options
 */
export interface SwapOptions {
  /** Override slippage from quote (basis points) */
  slippageBps?: number;
  /** Custom gas limit */
  gasLimit?: number;
  /** Custom gas price */
  gasPrice?: string;
  /** Memo to include in transaction */
  memo?: string;
  /** Skip balance validation (internal use) */
  skipBalanceValidation?: boolean;
}

/**
 * Swap execution result
 */
export interface SwapResult {
  /** Transaction hash */
  txHash: string;
  /** Transaction status */
  status: 'pending' | 'success' | 'failed';
  /** Input amount */
  fromAmount: string;
  /** Actual output amount (available after confirmation) */
  toAmount?: string;
  /** Fees paid */
  fee: string;
  /** Block height (available after confirmation) */
  blockHeight?: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// ORDER TYPES
// ============================================================================

/**
 * Order side
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Order status
 */
export type OrderStatus = 'open' | 'partial' | 'filled' | 'cancelled';

/**
 * Time in force options for limit orders
 */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

/**
 * Limit order parameters
 */
export interface LimitOrderParams {
  /** Trading pair */
  pair: TradingPair | string;
  /** Order side */
  side: OrderSide;
  /** Limit price */
  price: string;
  /** Order amount in base asset */
  amount: string;
  /** Time in force (default: GTC) */
  timeInForce?: TimeInForce;
}

/**
 * Order details
 */
export interface Order {
  /** Unique order ID */
  orderId: string;
  /** Owner address */
  owner: string;
  /** Trading pair */
  pair: TradingPair;
  /** Order side */
  side: OrderSide;
  /** Order price */
  price: string;
  /** Original order amount */
  amount: string;
  /** Filled amount */
  filled: string;
  /** Remaining amount */
  remaining: string;
  /** Order status */
  status: OrderStatus;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Order result after placement
 */
export interface OrderResult {
  /** Order ID */
  orderId: string;
  /** Transaction hash */
  txHash: string;
  /** Order details */
  order: Order;
}

// ============================================================================
// ORDERBOOK TYPES
// ============================================================================

/**
 * Order book entry
 */
export interface OrderBookEntry {
  /** Price level */
  price: string;
  /** Total amount at this price */
  amount: string;
  /** Total value (price * amount) */
  total: string;
}

/**
 * Full order book
 */
export interface OrderBook {
  /** Trading pair */
  pair: TradingPair;
  /** Buy orders (bids) - sorted high to low */
  bids: OrderBookEntry[];
  /** Sell orders (asks) - sorted low to high */
  asks: OrderBookEntry[];
  /** Bid-ask spread percentage */
  spread: string;
  /** Last traded price */
  lastPrice: string;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// CONTRACT TYPES (Internal)
// ============================================================================

/**
 * FIN contract ExecuteMsg variants
 * @internal
 */
export type FinExecuteMsg = 
  | { swap: SwapRequest }
  | { order: [OrderTarget[], CallbackData | null] }
  | { arb: { then?: string } };

/**
 * Swap request variants
 * @internal
 */
export type SwapRequest =
  | { yolo: { to?: string; callback?: CallbackData } }
  | { min: { min_return: string; to?: string; callback?: CallbackData } }
  | { exact: { exact_return: string; to?: string; callback?: CallbackData } }
  | { limit: { price: string; to?: string; callback?: CallbackData } };

/**
 * Order target tuple
 * @internal
 */
export type OrderTarget = [OrderSide, string, string | null];

/**
 * Callback data for contract composition
 * @internal
 */
export interface CallbackData {
  contract: string;
  msg: string;
}

/**
 * FIN contract QueryMsg variants
 * @internal
 */
export type FinQueryMsg =
  | { config: Record<string, never> }
  | { simulate: { denom: string; amount: string } }
  | { order: [string, OrderSide, string] }
  | { orders: { owner: string; side?: OrderSide; offset?: number; limit?: number } }
  | { book: { limit?: number; offset?: number } };

/**
 * Simulation response from FIN contract
 * @internal
 */
export interface SimulationResponse {
  returned: string;
  fee: string;
}

/**
 * Book response from FIN contract
 * @internal
 */
export interface BookResponse {
  base: Array<{ price: string; total: string }>;
  quote: Array<{ price: string; total: string }>;
}
