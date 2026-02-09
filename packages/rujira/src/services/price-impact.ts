/**
 * Price impact calculation for swap quotes
 * @module services/price-impact
 */

import Big from 'big.js';

import { LARGE_SWAP_THRESHOLD } from '../config/constants.js';
import type { OrderBook } from '../types.js';

/**
 * Calculate price impact for a swap using orderbook data when available.
 * Falls back to heuristic estimates when orderbook data is unavailable.
 */
export function calculatePriceImpact(
  inputAmount: string,
  outputAmount: string,
  orderbook: OrderBook | null
): string {
  if (!orderbook) {
    return estimatePriceImpactWithoutOrderbook(inputAmount);
  }

  const bestBid = orderbook.bids[0]?.price;
  const bestAsk = orderbook.asks[0]?.price;

  if (!bestBid || !bestAsk) {
    return estimatePriceImpactWithoutOrderbook(inputAmount);
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

/**
 * Estimate price impact heuristically when orderbook data is unavailable.
 */
function estimatePriceImpactWithoutOrderbook(inputAmount: string): string {
  const amount = BigInt(inputAmount);

  if (amount >= LARGE_SWAP_THRESHOLD) {
    return 'unknown';
  }

  const mediumSwapThreshold = BigInt('100000000000');

  if (amount >= mediumSwapThreshold) {
    return '2.0-5.0';
  }

  return '1.0-3.0';
}
