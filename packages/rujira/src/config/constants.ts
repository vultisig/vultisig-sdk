/**
 * Named constants replacing magic values throughout the Rujira SDK.
 * @module config/constants
 */

/** Swap amounts at or above this are considered "large" for price impact estimation. */
export const LARGE_SWAP_THRESHOLD = BigInt('1000000000000'); // 10,000 RUNE (8 dec)

/** Default THORChain native transaction fee (in base units, 8 decimals). */
export const DEFAULT_THORCHAIN_FEE = 2000000n; // 0.02 RUNE

/** Default gas price for THORChain transactions. */
export const DEFAULT_GAS_PRICE = '0.025rune';

/** Default timeout for waiting on transaction confirmation (ms). */
export const DEFAULT_TIMEOUT_MS = 60000;

/** Default taker fee for FIN orderbook contracts. */
export const DEFAULT_TAKER_FEE = '0.0015'; // 0.15%

/** Default maker fee for FIN orderbook contracts. */
export const DEFAULT_MAKER_FEE = '0.00075'; // 0.075%

/**
 * Fallback outbound fees per chain (base units, 8 decimals for most chains).
 * Captured from THORNode on 2026-02-08 — only used when THORNode API is unreachable.
 * Run LIVE_TESTS=1 to verify against current THORNode values.
 */
export const FALLBACK_OUTBOUND_FEES: Record<string, string> = {
  BTC: '1572',
  ETH: '12319',
  BSC: '40318',
  AVAX: '2845482',
  GAIA: '13088900',
  DOGE: '267956702',
  LTC: '473869',
  BCH: '48635',
  BASE: '12324',
  TRON: '94966900',
  XRP: '18038300',
};

/** THORChain decimal precision (8 decimals). */
export const THORCHAIN_DECIMALS = 8;
