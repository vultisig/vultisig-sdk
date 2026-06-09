import { EvmChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { Coin } from '../../../../../coin/Coin'
import {
  BlockaidEvmBalanceChange,
  BlockaidEvmSimulationInfo,
  BlockaidSolanaSimulationInfo,
  BlockaidSuiAsset,
  BlockaidSuiSimulationInfo,
} from '../core'

const SUI_NATIVE_COIN_TYPE = '0x2::sui::SUI'

// Blockaid's `/sui/transaction/scan` simulation block exposes per-asset diffs
// under `account_summary.account_assets_diffs` (plural). Asset entries use
// `type === 'NATIVE'` for SUI and `type === 'COIN'` for fungible Move coins,
// with the Move type tag at `asset.id`. `raw_value` is returned as a JS
// number for Sui, in the asset's base units. The parser falls back to `null`
// on any shape it doesn't recognise so a Blockaid response change surfaces
// as "no preview" instead of crashing the popup.
type BlockaidSuiRawAssetSide = {
  usd_price?: number
  summary?: string
  value?: number | string
  raw_value: number | string
}

type BlockaidSuiRawAsset = {
  type?: 'NATIVE' | 'COIN' | 'TOKEN' | 'SUI' | string
  asset_type?: 'NATIVE' | 'COIN' | 'TOKEN' | 'SUI' | string
  name?: string
  symbol?: string
  // Sui Move type tag, e.g. `0xa9…::navx::NAVX`. Native SUI has no `id`.
  id?: string
  coin_type?: string
  address?: string
  decimals: number
  logo?: string
  logo_url?: string
}

type BlockaidSuiRawAssetDiff = {
  asset: BlockaidSuiRawAsset
  in: BlockaidSuiRawAssetSide | null
  out: BlockaidSuiRawAssetSide | null
  asset_type?: 'NATIVE' | 'COIN' | 'TOKEN' | 'SUI' | string
}

export type BlockaidSuiSimulation = {
  status?: 'Success' | 'Failure'
  account_summary?: {
    account_assets_diffs?: BlockaidSuiRawAssetDiff[]
    // Older / alternate key — keep the singular fallback in case Blockaid
    // swaps naming without notice.
    account_assets_diff?: BlockaidSuiRawAssetDiff[]
  }
}

const isNativeSui = (asset: BlockaidSuiRawAsset): boolean =>
  asset.type === 'NATIVE' ||
  asset.type === 'SUI' ||
  asset.asset_type === 'NATIVE' ||
  asset.coin_type === SUI_NATIVE_COIN_TYPE ||
  (!asset.id && !asset.coin_type && !asset.address && asset.symbol === 'SUI')

const coinTypeFromAsset = (asset: BlockaidSuiRawAsset): string | null => {
  if (asset.id) return asset.id
  if (asset.coin_type) return asset.coin_type
  if (asset.address) return asset.address
  if (isNativeSui(asset)) return SUI_NATIVE_COIN_TYPE
  return null
}

const toBigInt = (raw: number | string): bigint => {
  if (typeof raw === 'bigint') return raw
  if (typeof raw === 'number') return BigInt(Math.trunc(raw))
  if (/^-?\d+$/.test(raw)) return BigInt(raw)
  // Fallback for decimal strings ("1.234"). Blockaid usually emits integer
  // raw_values, but normalise just in case.
  return BigInt(Math.trunc(Number(raw)))
}

/**
 * Parse a Blockaid Sui simulation into the user's net balance changes,
 * mirroring how Solana classifies into a `swap` or `transfer` headline.
 * Returns `null` if the response shape doesn't expose any asset diffs we can
 * interpret — the popup falls back to the decoded-command view in that case.
 */
export const parseBlockaidSuiSimulation = async (
  simulation: BlockaidSuiSimulation
): Promise<BlockaidSuiSimulationInfo | null> => {
  const assetDiffs =
    simulation.account_summary?.account_assets_diffs ??
    simulation.account_summary?.account_assets_diff
  if (!assetDiffs || assetDiffs.length === 0) return null

  // When we have 3 items and one is native SUI, filter it out and use the
  // other two tokens — the native SUI is likely the gas charge, not part of
  // the swap itself. Same heuristic as Solana.
  let relevantDiffs = assetDiffs
  if (assetDiffs.length === 3) {
    const nativeIdx = assetDiffs.findIndex(diff => isNativeSui(diff.asset))
    if (nativeIdx !== -1) {
      relevantDiffs = assetDiffs.filter((_, i) => i !== nativeIdx)
    }
  }

  if (relevantDiffs.length === 1) {
    const [diff] = relevantDiffs
    if (!diff.out) return null
    const from = blockaidSuiAssetFrom(diff.asset)
    if (!from) return null
    return {
      transfer: {
        from,
        fromAmount: toBigInt(diff.out.raw_value),
      },
    }
  }

  // Two or more diffs — try to surface a swap (one out + one in on different
  // assets). Falls back to a transfer headline if we can't pair them.
  const outDiff = relevantDiffs.find(d => d.out !== null)
  const inDiff = relevantDiffs.find(d => d.in !== null && d !== outDiff)

  if (outDiff && outDiff.out && inDiff && inDiff.in) {
    const from = blockaidSuiAssetFrom(outDiff.asset)
    const to = blockaidSuiAssetFrom(inDiff.asset)
    if (from && to && from.coinType !== to.coinType) {
      return {
        swap: {
          from,
          to,
          fromAmount: toBigInt(outDiff.out.raw_value),
          toAmount: toBigInt(inDiff.in.raw_value),
        },
      }
    }
  }

  if (outDiff && outDiff.out) {
    const from = blockaidSuiAssetFrom(outDiff.asset)
    if (from) {
      return {
        transfer: {
          from,
          fromAmount: toBigInt(outDiff.out.raw_value),
        },
      }
    }
  }

  return null
}

const blockaidSuiAssetFrom = (
  asset: BlockaidSuiRawAsset
): BlockaidSuiAsset | null => {
  const coinType = coinTypeFromAsset(asset)
  if (!coinType) return null
  return {
    coinType,
    symbol: asset.symbol || coinType.split('::').pop() || coinType,
    decimals: asset.decimals,
    logo: asset.logo_url ?? asset.logo,
  }
}

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

// Returns null for malformed ERC20 entries (missing address) so the caller
// can skip them instead of silently merging into the native bucket.
const groupKeyForAsset = (asset: EvmAssetDiff['asset']): string | null => {
  if (asset.type === 'NATIVE') return NATIVE_GROUP_KEY
  const address = asset.address?.toLowerCase()
  return address ?? null
}

const sumRaw = (sides: EvmAssetSide[]): bigint => sides.reduce((total, side) => total + BigInt(side.raw_value), 0n)

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

// `Coin.id` is token-only (see core/chain/coin/Coin.ts), and Blockaid sometimes
// returns the same contract with mismatched casing across diffs; lowercase the
// ERC20 address so downstream lookups don't depend on whichever case landed first.
const buildCoinFromAsset = (asset: EvmAssetDiff['asset'], chain: EvmChain): Coin => {
  const base: Coin = {
    decimals: asset.decimals,
    logo: asset.logo_url,
    ticker: asset.symbol,
    chain,
  }
  if (asset.type === 'ERC20' && asset.address) {
    return { ...base, id: asset.address.toLowerCase() }
  }
  return base
}

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
    if (key === null) continue
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
