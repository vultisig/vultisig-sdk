/**
 * Price impact calculation for swap quotes
 * @module services/price-impact
 */

import Big from 'big.js';

import type { OrderBook } from '../types.js';

/**
 * Input for calculatePriceImpact function.
 */
export type CalculatePriceImpactInput = {
  inputAmount: string;
  outputAmount: string;
  orderbook: OrderBook | null;
  /**
   * True when the swap direction is reversed relative to the orderbook's
   * base/quote convention (i.e., swapping quote → base instead of base → quote).
   */
  reversedToOrderbook: boolean;
};

/**
 * Calculate price impact for a swap using orderbook data when available.
 *
 * The swap direction may not match the orderbook's base/quote convention:
 * - Selling base (input=base, output=quote): executionPrice = output/input ≈ midPrice
 * - Buying base (input=quote, output=base): executionPrice = input/output ≈ midPrice
 *
 * The caller must specify `reversedToOrderbook` to indicate whether the swap
 * is in the opposite direction of the orderbook's base/quote pair.
 *
 * Returns 'unknown' when orderbook data is unavailable or when the
 * calculation cannot determine a reliable impact value.
 */
export function calculatePriceImpact({
  inputAmount,
  outputAmount,
  orderbook,
  reversedToOrderbook,
}: CalculatePriceImpactInput): string {
  if (!orderbook) {
    return 'unknown';
  }

  const bestBid = orderbook.bids[0]?.price;
  const bestAsk = orderbook.asks[0]?.price;

  if (!bestBid || !bestAsk) {
    return 'unknown';
  }

  const bidPrice = Big(bestBid);
  const askPrice = Big(bestAsk);

  if (bidPrice.lte(0) || askPrice.lte(0)) {
    return 'unknown';
  }

  const midPrice = bidPrice.plus(askPrice).div(2);

  const input = Big(inputAmount);
  const output = Big(outputAmount);

  if (input.lte(0) || output.lte(0)) {
    return '0';
  }

  // Calculate execution price based on swap direction relative to orderbook:
  // - Direct (selling base): executionPrice = output / input
  // - Reversed (buying base): executionPrice = input / output
  const executionPrice = reversedToOrderbook ? input.div(output) : output.div(input);

  const impact = executionPrice.minus(midPrice).div(midPrice).abs().mul(100);

  // If impact is unreasonably high, report as unknown
  if (impact.gt(99)) {
    return 'unknown';
  }

  return impact.toFixed(4);
}
