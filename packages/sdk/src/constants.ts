/**
 * SDK Constants
 * Shared constants to avoid circular dependencies
 */

import { Chain } from "@core/chain/Chain";

/**
 * Default chains for new vaults
 */
export const DEFAULT_CHAINS: Chain[] = [
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana,
  Chain.THORChain,
  Chain.Ripple,
];

/**
 * All supported chains (from Chain enum)
 */
export const SUPPORTED_CHAINS: Chain[] = Object.values(Chain);
