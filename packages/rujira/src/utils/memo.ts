/**
 * Memo utilities for THORChain transactions
 * @module utils/memo
 */

import type { FinExecuteMsg } from '../types';

/**
 * Build a CosmWasm execution memo for Layer 1 deposits
 * 
 * Format: x:{contract}:{base64_payload}
 * 
 * @param contractAddress - CosmWasm contract address
 * @param msg - Execute message to encode
 * @returns Formatted memo string
 * 
 * @example
 * ```typescript
 * const memo = buildExecuteMemo('thor1...fin...', {
 *   swap: { min: { min_return: '1000000' } }
 * });
 * // Returns: "x:thor1...fin...:eyJzd2FwIjp7Im1pbiI6eyJtaW5fcmV0dXJuIjoiMTAwMDAwMCJ9fX0="
 * ```
 */
export function buildExecuteMemo(
  contractAddress: string,
  msg: object
): string {
  const msgBase64 = Buffer.from(JSON.stringify(msg)).toString('base64');
  return `x:${contractAddress}:${msgBase64}`;
}

/**
 * Parse a CosmWasm execution memo
 * 
 * @param memo - Memo string to parse
 * @returns Parsed memo or null if invalid
 */
export function parseExecuteMemo(memo: string): {
  contract: string;
  msg: object;
} | null {
  if (!memo.startsWith('x:')) {
    return null;
  }

  const parts = memo.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const contract = parts[1];
  const msgBase64 = parts[2];

  if (!contract || !msgBase64) {
    return null;
  }

  try {
    const msg = JSON.parse(Buffer.from(msgBase64, 'base64').toString()) as object;
    return { contract, msg };
  } catch {
    return null;
  }
}

/**
 * Build a swap memo for Layer 1 deposits
 * 
 * @param contractAddress - FIN contract address
 * @param minReturn - Minimum return amount
 * @param destination - Destination address (optional)
 * @returns Formatted memo
 */
export function buildSwapMemo(
  contractAddress: string,
  minReturn: string,
  destination?: string
): string {
  const msg: FinExecuteMsg = {
    swap: {
      min: {
        min_return: minReturn,
        to: destination,
      }
    }
  };
  return buildExecuteMemo(contractAddress, msg);
}

/**
 * Build a standard THORChain swap memo
 * 
 * Format: =:ASSET:DESTINATION:LIMIT:AFFILIATE:FEE
 * 
 * @param asset - Destination asset (e.g., "BTC.BTC")
 * @param destination - Destination address
 * @param limit - Minimum output (optional)
 * @param affiliate - Affiliate address (optional)
 * @param affiliateFee - Affiliate fee in basis points (optional)
 */
export function buildThorSwapMemo(
  asset: string,
  destination: string,
  limit?: string,
  affiliate?: string,
  affiliateFee?: number
): string {
  const parts = ['=', asset, destination];
  
  if (limit) {
    parts.push(limit);
    
    if (affiliate && affiliateFee) {
      parts.push(affiliate);
      parts.push(affiliateFee.toString());
    }
  }
  
  return parts.join(':');
}

/**
 * Build a secured asset mint memo
 * 
 * Format: S+:DESTINATION
 * 
 * @param destination - THORChain address to receive secured asset
 */
export function buildSecureMintMemo(destination: string): string {
  return `S+:${destination}`;
}

/**
 * Build a secured asset redeem memo
 * 
 * Format: S-:DESTINATION
 * 
 * @param destination - L1 address to receive native asset
 */
export function buildSecureRedeemMemo(destination: string): string {
  return `S-:${destination}`;
}

/**
 * Parse a THORChain memo to determine its type
 */
export function parseMemoType(memo: string): 
  | { type: 'swap'; asset: string; destination: string }
  | { type: 'execute'; contract: string }
  | { type: 'secure-mint'; destination: string }
  | { type: 'secure-redeem'; destination: string }
  | { type: 'unknown' }
{
  if (memo.startsWith('=:')) {
    const parts = memo.split(':');
    return {
      type: 'swap',
      asset: parts[1] || '',
      destination: parts[2] || '',
    };
  }
  
  if (memo.startsWith('x:')) {
    const parts = memo.split(':');
    return {
      type: 'execute',
      contract: parts[1] || '',
    };
  }
  
  if (memo.startsWith('S+:')) {
    return {
      type: 'secure-mint',
      destination: memo.slice(3),
    };
  }
  
  if (memo.startsWith('S-:')) {
    return {
      type: 'secure-redeem',
      destination: memo.slice(3),
    };
  }
  
  return { type: 'unknown' };
}

/**
 * Validate memo length (THORChain has a limit)
 */
export function validateMemoLength(memo: string, maxLength = 250): boolean {
  return memo.length <= maxLength;
}

/**
 * Estimate memo length for a swap
 */
export function estimateSwapMemoLength(
  contractAddress: string,
  minReturn: string,
  destination?: string
): number {
  const memo = buildSwapMemo(contractAddress, minReturn, destination);
  return memo.length;
}
