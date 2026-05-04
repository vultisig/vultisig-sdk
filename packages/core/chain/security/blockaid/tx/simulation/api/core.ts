import { EvmChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { Coin } from '../../../../../coin/Coin'
import {
  BlockaidEvmBalanceChange,
  BlockaidEvmSimulationInfo,
  BlockaidSolanaSimulationInfo,
} from '../core'

export type BlockaidSolanaSimulation = {
  account_summary: {
    account_assets_diff: Array<{
      asset: {
        type: 'TOKEN' | 'SOL'
        name?: string
        symbol?: string
        address?: string
        decimals: number
        logo: string
      }
      in: {
        usd_price: number
        summary: string
        value: number
        raw_value: string
      } | null
      out: {
        usd_price: number
        summary: string
        value: number
        raw_value: string
      } | null
      asset_type: 'TOKEN' | 'SOL'
    }>
  }
}

export type BlockaidEVMSimulation = {
  account_summary: {
    assets_diffs: Array<{
      asset_type: 'NATIVE' | 'ERC20'
      asset: {
        type: 'NATIVE' | 'ERC20'
        chain_name: string
        decimals: number
        chain_id: number
        address?: string
        logo_url: string
        name: string
        symbol: string
      }
      in: Array<{
        usd_price: number
        summary: string
        value: number
        raw_value: string
      }>
      out: Array<{
        usd_price: number
        summary: string
        value: number
        raw_value: string
      }>
      balance_changes: {
        before: {
          usd_price: number
          value: number
          raw_value: string
        }
        after: {
          usd_price: number
          value: number
          raw_value: string
        }
      }
    }>
  }
}

export const parseBlockaidSolanaSimulation = async (
  simulation: BlockaidSolanaSimulation
): Promise<BlockaidSolanaSimulationInfo> => {
  const assetDiffs = simulation.account_summary.account_assets_diff

  // When we have 3 items and one is native SOL, filter it out and use the other two tokens.
  // The native SOL is likely the transaction fee, not part of the swap itself.
  let relevantDiffs = assetDiffs
  if (assetDiffs.length === 3) {
    const nativeSolIndex = assetDiffs.findIndex(diff => diff.asset.type === 'SOL' || diff.asset_type === 'SOL')
    if (nativeSolIndex !== -1) {
      relevantDiffs = assetDiffs.filter((_, index) => index !== nativeSolIndex)
    }
  }

  if (relevantDiffs.length === 1) {
    const [potentialOutAsset] = relevantDiffs

    if (!potentialOutAsset.out) {
      throw new Error('Invalid simulation data: no out value for transfer')
    }

    return {
      transfer: {
        fromMint:
          potentialOutAsset.asset.type === 'SOL'
            ? 'So11111111111111111111111111111111111111112'
            : shouldBePresent(potentialOutAsset.asset.address),
        fromAmount: BigInt(shouldBePresent(potentialOutAsset.out).raw_value),
      },
    }
  }

  if (relevantDiffs.length > 1) {
    const [potentialOutAsset, potentialInAsset] = relevantDiffs
    const { inAsset, inValue } = potentialInAsset.in
      ? {
          inAsset: potentialInAsset.asset,
          inValue: potentialInAsset.in,
        }
      : {
          inAsset: potentialOutAsset.asset,
          inValue: potentialOutAsset.in,
        }

    const { outAsset, outValue } = potentialOutAsset.out
      ? {
          outAsset: potentialOutAsset.asset,
          outValue: potentialOutAsset.out,
        }
      : {
          outAsset: potentialInAsset.asset,
          outValue: potentialInAsset.out,
        }
    if (outAsset && inAsset && outValue && inValue) {
      return {
        swap: {
          fromMint:
            outAsset.type === 'SOL' ? 'So11111111111111111111111111111111111111112' : shouldBePresent(outAsset.address),
          toMint:
            inAsset.type === 'SOL' ? 'So11111111111111111111111111111111111111112' : shouldBePresent(inAsset.address),
          fromAmount: BigInt(shouldBePresent(outValue).raw_value),
          toAmount: BigInt(shouldBePresent(inValue).raw_value),
          toAssetDecimal: inAsset.decimals,
        },
      }
    } else if (outAsset && outValue) {
      return {
        transfer: {
          fromMint:
            outAsset.type === 'SOL' ? 'So11111111111111111111111111111111111111112' : shouldBePresent(outAsset.address),
          fromAmount: BigInt(shouldBePresent(outValue).raw_value),
        },
      }
    }
  }
  throw new Error('Invalid simulation data')
}

type EvmAssetDiff = BlockaidEVMSimulation['account_summary']['assets_diffs'][number]
type EvmAssetSide = EvmAssetDiff['in'][number]

const NATIVE_GROUP_KEY = 'native'

const groupKeyForAsset = (asset: EvmAssetDiff['asset']): string =>
  asset.address?.toLowerCase() ?? NATIVE_GROUP_KEY

const sumRaw = (sides: EvmAssetSide[]): bigint =>
  sides.reduce((total, side) => total + BigInt(side.raw_value), 0n)

const usdValueForSides = (sides: EvmAssetSide[]): number => {
  let total = 0
  let hasPrice = false
  for (const side of sides) {
    if (typeof side.usd_price === 'number' && side.usd_price > 0) {
      hasPrice = true
    }
    total += side.value * side.usd_price
  }
  return hasPrice ? total : 0
}

const buildCoinFromAsset = (
  asset: EvmAssetDiff['asset'],
  chain: EvmChain
): Coin => ({
  decimals: asset.decimals,
  logo: asset.logo_url,
  ticker: asset.symbol,
  id: asset.address,
  chain,
})

/**
 * Parse a Blockaid EVM simulation into the user's net balance changes.
 *
 * Blockaid returns one entry per asset under `assets_diffs`, with separate
 * `in` and `out` arrays that can each have multiple legs (router-mediated
 * `permitAndCall` flows, multicalls, multi-hop swaps, etc.). We group all
 * legs by canonical asset (lowercased address; native uses a sentinel key),
 * sum each side, and emit one change per asset with the net direction.
 *
 * Refund-shaped pairs (same asset on both `in` and `out`) cancel out to a
 * net of zero and are skipped — both casing-variant duplicates from
 * Blockaid metadata noise and real same-asset refunds collapse to the
 * accurate "no change" outcome.
 */
export const parseBlockaidEvmSimulation = async (
  simulation: BlockaidEVMSimulation,
  chain: EvmChain
): Promise<BlockaidEvmSimulationInfo> => {
  if (!isChainOfKind(chain, 'evm')) {
    throw new Error(`parseBlockaidEvmSimulation only supports EVM chains, got: ${chain}`)
  }

  type Group = {
    asset: EvmAssetDiff['asset']
    netRaw: bigint
    netUsd: number
  }

  const groups = new Map<string, Group>()

  for (const diff of simulation.account_summary.assets_diffs) {
    const key = groupKeyForAsset(diff.asset)
    const sentRaw = sumRaw(diff.out)
    const receivedRaw = sumRaw(diff.in)
    const sentUsd = usdValueForSides(diff.out)
    const receivedUsd = usdValueForSides(diff.in)

    const existing = groups.get(key)
    if (existing) {
      existing.netRaw += receivedRaw - sentRaw
      existing.netUsd += receivedUsd - sentUsd
    } else {
      groups.set(key, {
        asset: diff.asset,
        netRaw: receivedRaw - sentRaw,
        netUsd: receivedUsd - sentUsd,
      })
    }
  }

  const changes: BlockaidEvmBalanceChange[] = []
  for (const { asset, netRaw, netUsd } of groups.values()) {
    if (netRaw === 0n) continue
    const direction: 'send' | 'receive' = netRaw > 0n ? 'receive' : 'send'
    const amount = netRaw > 0n ? netRaw : -netRaw
    const change: BlockaidEvmBalanceChange = {
      direction,
      coin: buildCoinFromAsset(asset, chain),
      amount: shouldBePresent(amount),
    }
    if (netUsd !== 0) {
      change.usdValue = Math.abs(netUsd)
    }
    changes.push(change)
  }

  if (changes.length === 0) {
    return null
  }

  return { changes }
}
