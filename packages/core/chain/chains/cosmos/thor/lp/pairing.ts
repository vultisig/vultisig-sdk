import { Chain } from '@vultisig/core-chain/Chain'

import { chainPrefixToChain } from './lpChainMap'
import { assertValidPoolId } from './pools'

export type VaultAddressMap = Partial<Record<Chain, string>>

export type LpSide = 'rune' | 'asset'

/**
 * Resolve the paired-address for an LP add based on which side of the
 * pool the caller is depositing.
 *
 * - `side: 'rune'` (depositing RUNE on THORChain): returns the vault's L1
 *   address on the pool's ASSET chain. E.g. `BTC.BTC` → vault's BTC
 *   address.
 * - `side: 'asset'` (depositing L1 asset): returns the vault's THORChain
 *   address (`thor1...`).
 *
 * Matches vultisig-ios `FunctionCallAddThorLP.prefillPairedAddressForPool`
 * and vultisig-windows (the extension) `ThorLpSpecific.tsx`
 * behavior exactly — both always auto-populate the paired address when the
 * vault has the required address, producing a symmetric-pending memo.
 *
 * Returns `undefined` when the vault map does not contain the required
 * address. The caller decides whether to:
 *   - fall back to a pure asymmetric deposit (`+:POOL` with no paired
 *     address), or
 *   - surface an error ("add the other chain to your vault first").
 */
export const resolvePairedAddressForLpAdd = ({
  pool,
  side,
  vaultAddresses,
}: {
  pool: string
  side: LpSide
  vaultAddresses: VaultAddressMap
}): string | undefined => {
  assertValidPoolId(pool)

  // Guard against unknown pool prefixes on BOTH sides — the pool id regex
  // accepts `ZZZ.ABC` but `chainPrefixToChain` is the source of truth for
  // THORChain-supported chains. If we can't resolve the prefix we refuse
  // to auto-pair either way; the caller can still fall back to a pure
  // asym memo if they want.
  const [chainPrefix] = pool.split('.')
  if (!chainPrefix) return undefined
  const assetChain = chainPrefixToChain(chainPrefix)
  if (!assetChain) return undefined

  if (side === 'asset') {
    return vaultAddresses[Chain.THORChain]
  }

  // side === 'rune' — need the vault's address on the pool's asset chain
  return vaultAddresses[assetChain]
}
