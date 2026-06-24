import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getAddress, isAddress } from 'viem'

import { erc4626ReadAbi } from './abi'
import type { ArkisPoolKind } from './buildSupplyTx'

export type ResolveArkisPoolKindResult = {
  kind: ArkisPoolKind
  /** Underlying asset address for ERC-4626 vaults (undefined for Agreements). */
  asset?: `0x${string}`
}

/**
 * Detect whether an Arkis pool is an ERC-4626 vault or a standard Agreement by
 * probing `asset()`. A successful read with a valid address ⇒ ERC-4626 vault;
 * a revert (no `asset()`) ⇒ Agreement.
 *
 * Read-only `eth_call` on Ethereum — never mutates state.
 */
export const resolveArkisPoolKind = async (poolAddress: string): Promise<ResolveArkisPoolKindResult> => {
  if (!isAddress(poolAddress, { strict: false })) {
    throw new Error(`invalid "pool_address" address: ${poolAddress}`)
  }
  const normalized = getAddress(poolAddress)
  const client = getEvmClient('Ethereum')

  try {
    const asset = (await client.readContract({
      address: normalized,
      abi: erc4626ReadAbi,
      functionName: 'asset',
    })) as string
    if (typeof asset === 'string' && isAddress(asset, { strict: false })) {
      return { kind: 'erc4626_vault', asset: getAddress(asset) }
    }
  } catch {
    // asset() reverted — treat as a standard Agreement.
  }
  return { kind: 'agreement' }
}
