/**
 * Outbound Fee Verification Tests
 *
 * Verifies that hardcoded fallback fees are within acceptable range
 * of live THORNode values.
 *
 * US-022: Audit item L2 verification
 */

import { describe, it, expect } from 'vitest';

// Hardcoded fallback fees from withdraw.ts (captured 2026-02-08)
const FALLBACK_FEES: Record<string, string> = {
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

describe('Outbound Fee Configuration', () => {
  it('has fallback fees for common chains', () => {
    const expectedChains = ['BTC', 'ETH', 'BSC', 'AVAX', 'GAIA', 'DOGE', 'LTC', 'BCH'];
    for (const chain of expectedChains) {
      expect(FALLBACK_FEES[chain]).toBeDefined();
      expect(BigInt(FALLBACK_FEES[chain])).toBeGreaterThan(0n);
    }
  });

  it('has positive values for all configured chains', () => {
    for (const [chain, fee] of Object.entries(FALLBACK_FEES)) {
      expect(BigInt(fee)).toBeGreaterThan(0n);
    }
  });
});

/**
 * Live verification tests - run with LIVE_TESTS=1
 *
 * These tests query THORNode to verify fallback fees are within
 * acceptable range (3x tolerance for gas price volatility).
 */
describe.skipIf(!process.env.LIVE_TESTS)('Live Outbound Fee Verification', () => {
  const THORNODE_URL = 'https://thornode.ninerealms.com';

  // Allow 3x variance for gas price volatility
  // Fees can change significantly with network conditions
  const TOLERANCE_FACTOR = 3n;

  it('verifies fallback fees are within 3x of live values', async () => {
    const response = await fetch(`${THORNODE_URL}/thorchain/inbound_addresses`);
    const addresses = (await response.json()) as Array<{
      chain: string;
      outbound_fee: string;
    }>;

    const results: Array<{
      chain: string;
      fallback: string;
      live: string;
      ratio: number;
      status: 'ok' | 'warning' | 'stale';
    }> = [];

    for (const { chain, outbound_fee } of addresses) {
      const fallback = FALLBACK_FEES[chain];
      if (!fallback) continue;

      const fallbackBigInt = BigInt(fallback);
      const liveBigInt = BigInt(outbound_fee);

      // Calculate ratio (higher of fallback/live or live/fallback)
      const ratio =
        fallbackBigInt > liveBigInt
          ? Number(fallbackBigInt) / Number(liveBigInt)
          : Number(liveBigInt) / Number(fallbackBigInt);

      results.push({
        chain,
        fallback,
        live: outbound_fee,
        ratio,
        status: ratio <= 1.5 ? 'ok' : ratio <= 3 ? 'warning' : 'stale',
      });

      // Assert within tolerance
      const minAcceptable = liveBigInt / TOLERANCE_FACTOR;
      const maxAcceptable = liveBigInt * TOLERANCE_FACTOR;

      expect(
        fallbackBigInt >= minAcceptable && fallbackBigInt <= maxAcceptable,
        `${chain} fallback ${fallback} is outside 3x range of live ${outbound_fee} (ratio: ${ratio.toFixed(2)}x)`
      ).toBe(true);
    }

    // Log summary
    console.log('\nOutbound Fee Comparison:');
    console.log('========================');
    for (const r of results) {
      const icon = r.status === 'ok' ? '✓' : r.status === 'warning' ? '⚠' : '✗';
      console.log(`${icon} ${r.chain}: fallback=${r.fallback}, live=${r.live} (${r.ratio.toFixed(2)}x)`);
    }
  });

  it('verifies ETH fee specifically (L2 audit item)', async () => {
    const response = await fetch(`${THORNODE_URL}/thorchain/inbound_addresses`);
    const addresses = (await response.json()) as Array<{
      chain: string;
      outbound_fee: string;
    }>;

    const ethInfo = addresses.find((a) => a.chain === 'ETH');
    expect(ethInfo).toBeDefined();

    const fallbackEth = BigInt(FALLBACK_FEES.ETH);
    const liveEth = BigInt(ethInfo!.outbound_fee);

    // Calculate percentage difference
    const diff = fallbackEth > liveEth ? fallbackEth - liveEth : liveEth - fallbackEth;
    const percentDiff = (Number(diff) / Number(liveEth)) * 100;

    console.log(`\nETH Outbound Fee:`);
    console.log(`  Fallback: ${FALLBACK_FEES.ETH}`);
    console.log(`  Live: ${ethInfo!.outbound_fee}`);
    console.log(`  Difference: ${percentDiff.toFixed(1)}%`);

    // Should be within 3x
    expect(fallbackEth >= liveEth / 3n).toBe(true);
    expect(fallbackEth <= liveEth * 3n).toBe(true);
  });
});
