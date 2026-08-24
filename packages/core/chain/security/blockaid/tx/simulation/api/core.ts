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

// Convert Blockaid's `raw_value` (always an integer in the asset's base unit,
// emitted as either a JS number or a numeric string) to a bigint. Returns
// `null` for any input we can't safely represent — `NaN`, `Infinity`, unsafe
// JS numbers (precision loss above 2^53), or non-integer strings. The parser
// propagates the `null` so a malformed amount degrades to "no preview"
// instead of throwing or quietly corrupting the displayed value.
const toBigInt = (raw: number | string): bigint | null => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) return null
    return BigInt(raw)
  }
  if (!/^-?\d+$/.test(raw)) return null
  return BigInt(raw)
}

// A native leg may be excluded from the headline only on evidence that it
// is gas noise: a single-sided movement bounded by a generous fee ceiling.
// Excluding on array shape alone can delete the transaction's principal
// leg and hide — or reverse — the displayed direction (vultisig-sdk#2091).
const SUI_GAS_AND_STORAGE_CEILING = 50_000_000n // 0.05 SUI in MIST

const isSuiGasNoiseDiff = (diff: BlockaidSuiRawAssetDiff): boolean => {
  if (!isNativeSui(diff.asset)) return false
  const side = diff.out && !diff.in ? diff.out : diff.in && !diff.out ? diff.in : null
  if (!side) return false
  const raw = toBigInt(side.raw_value)
  return raw !== null && raw >= 0n && raw <= SUI_GAS_AND_STORAGE_CEILING
}

/**
 * Parse a Blockaid Sui simulation into the user's net balance changes,
 * mirroring how Solana classifies into a `swap` or `transfer` headline.
 *
 * Only emits a headline when the diff set is unambiguous after excluding
 * at most one gas-sized native leg (a native leg is never excluded on
 * position alone — a principal SUI movement stays in the summary):
 *   - exactly one out-only diff → `transfer`
 *   - exactly two diffs, one out-only + one in-only on different assets
 *     → `swap`
 *
 * Anything more complex (e.g. a swap that also sends a third asset)
 * returns `null` — a partial "you're swapping…" headline would hide the
 * additional movement and mislead users approving the transaction. The
 * popup falls back to the decoded-command view when this returns `null`.
 */
export const parseBlockaidSuiSimulation = async (
  simulation: BlockaidSuiSimulation
): Promise<BlockaidSuiSimulationInfo | null> => {
  const assetDiffs = simulation.account_summary?.account_assets_diffs ?? simulation.account_summary?.account_assets_diff
  if (!assetDiffs || assetDiffs.length === 0) return null

  let relevantDiffs = assetDiffs
  if (assetDiffs.length > 1) {
    const gasNoiseIdx = assetDiffs.findIndex(isSuiGasNoiseDiff)
    if (gasNoiseIdx !== -1) {
      relevantDiffs = assetDiffs.filter((_, i) => i !== gasNoiseIdx)
    }
  }

  if (relevantDiffs.length === 1) {
    const [diff] = relevantDiffs
    // A single diff with an `in` side but no `out` would be a pure receive;
    // we don't surface that as a "you're sending" headline.
    if (!diff.out || diff.in) return null
    const from = blockaidSuiAssetFrom(diff.asset)
    if (!from) return null
    const fromAmount = toBigInt(diff.out.raw_value)
    if (fromAmount === null) return null
    return {
      transfer: {
        from,
        fromAmount,
      },
    }
  }

  // Strict two-diff swap: one diff is out-only, the other is in-only, and
  // they're on different assets. Anything else (mixed in+out on one side,
  // three+ relevant diffs, same-asset refund pair) returns `null` rather
  // than risk a misleading partial headline.
  if (relevantDiffs.length !== 2) return null

  const [a, b] = relevantDiffs
  const outDiff = !a.in && a.out ? a : !b.in && b.out ? b : null
  const inDiff = !a.out && a.in ? a : !b.out && b.in ? b : null
  if (!outDiff || !inDiff || outDiff === inDiff) return null
  if (!outDiff.out || !inDiff.in) return null

  const from = blockaidSuiAssetFrom(outDiff.asset)
  const to = blockaidSuiAssetFrom(inDiff.asset)
  if (!from || !to || from.coinType === to.coinType) return null

  const fromAmount = toBigInt(outDiff.out.raw_value)
  const toAmount = toBigInt(inDiff.in.raw_value)
  if (fromAmount === null || toAmount === null) return null

  return {
    swap: {
      from,
      to,
      fromAmount,
      toAmount,
    },
  }
}

const blockaidSuiAssetFrom = (asset: BlockaidSuiRawAsset): BlockaidSuiAsset | null => {
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

type BlockaidSolanaAssetDiff = BlockaidSolanaSimulation['account_summary']['account_assets_diff'][number]

const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'

const isNativeSol = (diff: BlockaidSolanaAssetDiff): boolean => diff.asset.type === 'SOL' || diff.asset_type === 'SOL'

// Native SOL and the wrapped-SOL token map to the same mint on purpose:
// a SOL↔WSOL pair is a wrap, not a swap, and gets declined by the
// same-mint check below rather than shown as an exchange.
const solanaMintOf = (asset: BlockaidSolanaAssetDiff['asset']): string =>
  asset.type === 'SOL' ? WRAPPED_SOL_MINT : shouldBePresent(asset.address)

// A native-SOL leg may be excluded from the headline only on evidence that
// it is gas noise — a single-sided movement bounded by what a fee payer can
// plausibly lose (or regain) to fees, priority fees, and rent on temporary
// accounts. Excluding on array shape alone can delete the transaction's
// principal leg and reverse the displayed direction (vultisig-sdk#2091).
const SOL_GAS_AND_RENT_CEILING = 10_000_000n // 0.01 SOL in lamports

const isSolGasNoiseDiff = (diff: BlockaidSolanaAssetDiff): boolean => {
  if (!isNativeSol(diff)) return false
  const side = diff.out && !diff.in ? diff.out : diff.in && !diff.out ? diff.in : null
  if (!side) return false
  const raw = toBigInt(side.raw_value)
  return raw !== null && raw >= 0n && raw <= SOL_GAS_AND_RENT_CEILING
}

/**
 * Parse a Blockaid Solana simulation into a `swap` or `transfer` headline
 * for the approval screen.
 *
 * Emits a headline only when the diff set is unambiguous after excluding
 * at most one gas-sized native-SOL leg (a native leg is never excluded on
 * position alone — a principal SOL movement stays in the summary):
 *   - exactly one out-only diff → `transfer`
 *   - exactly two diffs, one out-only + one in-only on different mints
 *     → `swap`
 *
 * Anything else throws: a headline computed from a subset of the legs can
 * hide a movement or reverse the displayed direction (vultisig-sdk#2091).
 * Callers treat the throw as "no preview" and fall back to their raw or
 * decoded transaction view.
 */
export const parseBlockaidSolanaSimulation = async (
  simulation: BlockaidSolanaSimulation
): Promise<BlockaidSolanaSimulationInfo> => {
  const assetDiffs = simulation.account_summary.account_assets_diff

  let relevantDiffs = assetDiffs
  if (assetDiffs.length > 1) {
    const gasNoiseIndex = assetDiffs.findIndex(isSolGasNoiseDiff)
    if (gasNoiseIndex !== -1) {
      relevantDiffs = assetDiffs.filter((_, index) => index !== gasNoiseIndex)
    }
  }

  if (relevantDiffs.length === 1) {
    const [diff] = relevantDiffs

    // A diff that also carries an `in` side is not a plain send — the net
    // could even be a receive, so a "you're sending" headline would lie.
    if (!diff.out || diff.in) {
      throw new Error('Invalid simulation data: no unambiguous out value for transfer')
    }

    const fromAmount = toBigInt(diff.out.raw_value)
    if (fromAmount === null) {
      throw new Error('Invalid simulation data: malformed transfer amount')
    }

    return {
      transfer: {
        fromMint: solanaMintOf(diff.asset),
        fromAmount,
      },
    }
  }

  if (relevantDiffs.length === 2) {
    const [a, b] = relevantDiffs
    const outDiff = !a.in && a.out ? a : !b.in && b.out ? b : null
    const inDiff = !a.out && a.in ? a : !b.out && b.in ? b : null

    if (outDiff && inDiff) {
      const fromMint = solanaMintOf(outDiff.asset)
      const toMint = solanaMintOf(inDiff.asset)
      const fromAmount = toBigInt(shouldBePresent(outDiff.out).raw_value)
      const toAmount = toBigInt(shouldBePresent(inDiff.in).raw_value)

      if (fromMint !== toMint && fromAmount !== null && toAmount !== null) {
        return {
          swap: {
            fromMint,
            toMint,
            fromAmount,
            toAmount,
            toAssetDecimal: inDiff.asset.decimals,
          },
        }
      }
    }
  }

  throw new Error('Invalid simulation data: ambiguous asset diffs')
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
