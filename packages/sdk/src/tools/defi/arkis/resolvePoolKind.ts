import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getAddress, isAddress } from 'viem'
import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem'

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
  } catch (err) {
    // Only swallow an on-chain "no asset()" signal → standard Agreement. That can
    // surface two ways depending on the contract: a CONTRACT REVERT (no matching
    // selector and no fallback) OR EMPTY-DATA (0x) when a fallback returns nothing
    // and viem can't decode an address. Both mean "this pool has no asset() — treat
    // it as an Agreement". Re-throw everything else (transport timeouts, rate-limit,
    // network outage) so the caller can retry rather than silently mis-classifying
    // the pool kind and later building calldata against the wrong ABI.
    const cause = err instanceof ContractFunctionExecutionError ? err.cause : undefined
    const isNoAssetSignal =
      err instanceof ContractFunctionRevertedError ||
      err instanceof ContractFunctionZeroDataError ||
      cause instanceof ContractFunctionRevertedError ||
      cause instanceof ContractFunctionZeroDataError
    if (!isNoAssetSignal) throw err
  }
  return { kind: 'agreement' }
}
