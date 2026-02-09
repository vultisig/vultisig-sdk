/**
 * Withdraw fee estimation service
 * @module services/fee-estimator
 */

import { FALLBACK_OUTBOUND_FEES } from '../config/constants.js';
import { parseAsset } from '../utils/denom-conversion.js';
import { thornodeRateLimiter } from '../utils/rate-limiter.js';

/** Maps chain ID to its native gas asset in THORChain format */
const CHAIN_GAS_ASSETS: Record<string, string> = {
  BTC: 'BTC.BTC',
  ETH: 'ETH.ETH',
  BSC: 'BSC.BNB',
  AVAX: 'AVAX.AVAX',
  GAIA: 'GAIA.ATOM',
  DOGE: 'DOGE.DOGE',
  LTC: 'LTC.LTC',
  BCH: 'BCH.BCH',
  BASE: 'BASE.ETH',
  TRON: 'TRON.TRX',
  XRP: 'XRP.XRP',
};

/**
 * Estimate the outbound fee for a withdrawal.
 *
 * Resolution order:
 * 1. Fetch live outbound_fee from THORNode inbound_addresses
 * 2. Fall back to hardcoded FALLBACK_OUTBOUND_FEES
 * 3. For non-gas-asset tokens, convert via pool ratio
 */
export async function estimateWithdrawFee(
  thornodeUrl: string,
  asset: string,
  _amount: string
): Promise<string> {
  const { chain } = parseAsset(asset);

  let gasAssetOutboundFee = '0';
  try {
    const response = await thornodeRateLimiter.fetch(`${thornodeUrl}/thorchain/inbound_addresses`);
    if (response.ok) {
      const addresses = (await response.json()) as Array<{ chain: string; outbound_fee: string }>;
      const chainInfo = addresses.find((a) => a.chain === chain);
      if (chainInfo?.outbound_fee) {
        gasAssetOutboundFee = chainInfo.outbound_fee;
      }
    }
  } catch {
    // ignore and fall back below
  }

  if (gasAssetOutboundFee === '0') {
    gasAssetOutboundFee = FALLBACK_OUTBOUND_FEES[chain] || '0';
    if (gasAssetOutboundFee !== '0') {
      console.warn(
        `[RujiraWithdraw] Using hardcoded fallback gas fee for ${chain}: ${gasAssetOutboundFee}. ` +
          'THORNode inbound_addresses endpoint may be unreachable. Fee estimate may be stale.'
      );
    }
  }

  // For native gas assets (e.g. BTC.BTC, BSC.BNB), the outbound fee is directly the gas fee
  const gasAsset = CHAIN_GAS_ASSETS[chain] || `${chain}.${chain}`;
  if (asset.toUpperCase() === gasAsset) {
    return gasAssetOutboundFee;
  }

  // For non-gas tokens, convert fee via pool ratios
  try {
    const gasPoolAsset = gasAsset;

    const [gasPoolResp, targetPoolResp] = await Promise.all([
      thornodeRateLimiter.fetch(`${thornodeUrl}/thorchain/pool/${gasPoolAsset}`),
      thornodeRateLimiter.fetch(`${thornodeUrl}/thorchain/pool/${asset.toUpperCase()}`),
    ]);

    if (!gasPoolResp.ok || !targetPoolResp.ok) {
      return gasAssetOutboundFee;
    }

    const gasPool = (await gasPoolResp.json()) as { balance_asset: string; balance_rune: string };
    const targetPool = (await targetPoolResp.json()) as {
      balance_asset: string;
      balance_rune: string;
    };

    const gasFee = BigInt(gasAssetOutboundFee);
    const gasBalAsset = BigInt(gasPool.balance_asset);
    const gasBalRune = BigInt(gasPool.balance_rune);
    const tgtBalAsset = BigInt(targetPool.balance_asset);
    const tgtBalRune = BigInt(targetPool.balance_rune);

    if (
      gasFee === 0n ||
      gasBalAsset === 0n ||
      gasBalRune === 0n ||
      tgtBalAsset === 0n ||
      tgtBalRune === 0n
    ) {
      return gasAssetOutboundFee;
    }

    const runeFee = (gasFee * gasBalRune) / gasBalAsset;
    const assetFee = (runeFee * tgtBalAsset) / tgtBalRune;

    return assetFee.toString();
  } catch {
    return gasAssetOutboundFee;
  }
}
