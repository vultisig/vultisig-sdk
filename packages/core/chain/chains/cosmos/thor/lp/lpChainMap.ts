import { Chain } from '@vultisig/core-chain/Chain'

import { thorchainLpChainCode } from '../thorchainLp'

/**
 * Mapping from THORChain pool-id chain prefix to the SDK's `Chain` enum.
 *
 * This is the reverse of `thorchainLpChainCode` in the sibling
 * `thorchainLp.ts` module (which maps `Chain` → prefix string). We derive
 * it here instead of hand-rolling to keep the two directions in lockstep
 * automatically.
 *
 * Reference: vultisig-windows (the extension)
 * `core/ui/storage/defiPositions.tsx` uses the same map.
 */
export const lpChainMap: Readonly<Record<string, Chain>> = Object.freeze(
  Object.entries(thorchainLpChainCode).reduce<Record<string, Chain>>(
    (acc, [chainKey, prefix]) => {
      if (prefix) {
        acc[prefix] = chainKey as Chain
      }
      return acc
    },
    {}
  )
)

/**
 * Resolve a THORChain pool-id chain prefix (e.g. `BTC`, `ETH`, `GAIA`) to
 * the SDK's `Chain` enum. Returns `undefined` for unknown prefixes.
 */
export const chainPrefixToChain = (prefix: string): Chain | undefined =>
  lpChainMap[prefix.toUpperCase()]

/**
 * Resolve a `Chain` enum value to the THORChain pool-id prefix (e.g.
 * `Chain.Bitcoin` → `BTC`). Returns `undefined` for chains THORChain does
 * not support in pools.
 */
export const chainToLpPrefix = (chain: Chain): string | undefined =>
  thorchainLpChainCode[chain]
