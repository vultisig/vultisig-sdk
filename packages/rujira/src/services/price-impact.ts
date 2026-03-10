/**
 * Price impact calculation for swap quotes
 * @module services/price-impact
 */

import Big from 'big.js';

import type { OrderBook } from '../types.js';

/**
 * Calculate price impact for a swap using orderbook data when available.
 *
 * The swap direction may not match the orderbook's base/quote convention:
 * - Buying base (input=quote, output=base): executionPrice ≈ midPrice
 * - Selling base (input=base, output=quote): executionPrice ≈ 1/midPrice
 *
 * To handle both directions without needing asset metadata, we compute
 * impact in both orientations and use whichever yields the lower (more
 * plausible) result.
 *
 * Returns 'unknown' when orderbook data is unavailable or when the
 * calculation cannot determine a reliable impact value.
 */
export function calculatePriceImpact(
  inputAmount: string,
  outputAmount: string,
  orderbook: OrderBook | null
): string {
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

  // Compute impact in both pair directions:
  // Direct:  assumes executionPrice is in the same units as midPrice
  // Inverse: assumes executionPrice is the reciprocal (swap direction reversed)
  const impactDirect = executionPrice.minus(midPrice).div(midPrice).abs().mul(100);

  const inverseExecutionPrice = input.div(output);
  const impactInverse = inverseExecutionPrice.minus(midPrice).div(midPrice).abs().mul(100);

  // Use the direction that yields the lower (more plausible) impact
  const impact = impactDirect.lt(impactInverse) ? impactDirect : impactInverse;

  // If neither direction produces a reasonable result, report as unknown
  if (impact.gt(99)) {
    return 'unknown';
  }

  return impact.toFixed(4);
}
