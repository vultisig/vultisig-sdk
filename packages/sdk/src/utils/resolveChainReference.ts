import type { Chain } from '@vultisig/core-chain/Chain'
import { getCosmosChainByChainId } from '@vultisig/core-chain/chains/cosmos/chainInfo'
import { getEvmChainByChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { numberToHex } from '@vultisig/lib-utils/hex/numberToHex'

import { normalizeChain, UnknownChainError } from './normalizeChain'

/**
 * Resolve an exact Cosmos chain ID or decimal EVM chain ID.
 *
 * Kept separate from name normalization so Skip's custody-chain guard can
 * retain its ID-only contract while sharing the same canonical lookup.
 */
export function resolveChainIdReference(chainId: string): Chain | undefined {
  if (/^[1-9][0-9]*$/.test(chainId)) {
    const numericId = Number(chainId)
    if (Number.isSafeInteger(numericId)) {
      const evm = getEvmChainByChainId(numberToHex(numericId))
      if (evm) return evm as Chain
    }
  }

  return getCosmosChainByChainId(chainId) as Chain | undefined
}

/**
 * Resolve a canonical name, alias, Cosmos chain ID, or decimal EVM chain ID
 * to the SDK's canonical Chain value.
 *
 * Unlike `normalizeChain`, this boundary is intentionally non-throwing so
 * clients can preserve their own unknown-input error or fallback behavior.
 * When `allowedChains` is provided, a valid reference outside that canonical
 * set is treated as unresolved.
 */
export function resolveChainReference(
  input: string | number | null | undefined,
  allowedChains?: readonly string[]
): Chain | undefined {
  const reference = typeof input === 'number' ? String(input) : (input?.trim() ?? '')
  if (!reference) return undefined

  let resolved = resolveChainIdReference(reference)
  if (!resolved) {
    try {
      resolved = normalizeChain(reference)
    } catch (error) {
      if (error instanceof UnknownChainError) return undefined
      throw error
    }
  }

  if (allowedChains && !allowedChains.includes(resolved)) return undefined
  return resolved
}
