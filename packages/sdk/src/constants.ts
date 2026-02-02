/**
 * SDK Constants
 * Shared constants to avoid circular dependencies
 */

import { Chain, defaultChains } from '@core/chain/Chain'

/**
 * Default chains for new vaults
 * Re-exported from core for backward compatibility
 */
export const DEFAULT_CHAINS: Chain[] = defaultChains

/**
 * All supported chains (from Chain enum)
 */
export const SUPPORTED_CHAINS: Chain[] = Object.values(Chain)
