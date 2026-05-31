import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

import { getThorchainInboundAddress } from '../../../chains/cosmos/thor/getThorchainInboundAddress'
import { getThorchainPools, ThorchainPoolSummary } from '../../../chains/cosmos/thor/lp/pools'
import { toNativeSwapAsset } from '../asset/toNativeSwapAsset'
import { NativeSwapChain, nativeSwapChainIds, nativeSwapEnabledChains } from '../NativeSwapChain'

/**
 * Multiplier applied to the destination chain's `outbound_fee` to derive the
 * minimum economically-viable swap output. A swap whose output barely covers
 * the outbound fee is dust by the time it lands, so THORChain rejects it with
 * no route. Requiring the output to clear ~2x the outbound fee keeps the
 * proactive threshold conservative (we'd rather under-report the minimum than
 * tell a user an amount is fine and then have the quote fail). Tunable.
 */
export const NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER = 2

/**
 * THORChain reports every pool depth and the `inbound_addresses` `outbound_fee`
 * in 1e8 base units regardless of the asset's native precision.
 */
const THORCHAIN_BASE_DECIMALS = 8

export type NativeSwapMinAmountIn = {
  swapChain: NativeSwapChain
  /** Minimum input amount in the `from` coin's native base units (`from.decimals`). */
  minAmountInBaseUnits: bigint
  /** Short human-readable minimum input for display, e.g. `"0.0042"`. */
  minAmountInHuman: string
  /** Destination chain `outbound_fee`, in THORChain 1e8 units of the dest gas asset. */
  outboundFeeBaseUnit: string
  /**
   * Source chain `dust_threshold`, in THORChain 1e8 units of the source gas
   * asset. `undefined` when the source chain is absent from `inbound_addresses`.
   */
  dustThresholdBaseUnit?: string
  /**
   * Which constraint produced the returned minimum: the destination
   * outbound-fee economics (`'outbound'`) or the source-chain dust threshold
   * (`'dust'`). Useful for instrumentation when diagnosing rejected swaps.
   */
  binding: 'outbound' | 'dust'
}

type NativeSwapMinDeps = {
  /** Injectable for tests. Defaults to the live thornode `inbound_addresses` fetch. */
  fetchInboundAddresses?: typeof getThorchainInboundAddress
  /** Injectable for tests. Defaults to the live Midgard `/v2/pools` fetch (all statuses). */
  fetchPools?: () => Promise<ThorchainPoolSummary[]>
}

type CacheEntry<T> = { at: number; value: Promise<T> }

const CACHE_TTL_MS = 5_000

let inboundCache: CacheEntry<Awaited<ReturnType<typeof getThorchainInboundAddress>>> | undefined
let poolsCache: CacheEntry<ThorchainPoolSummary[]> | undefined

const cached = <T>(entry: CacheEntry<T> | undefined, load: () => Promise<T>): CacheEntry<T> => {
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry
  }
  return { at: Date.now(), value: load() }
}

/**
 * Compute the minimum input amount for a native (THORChain) swap. The minimum
 * is the larger of two independent THORChain constraints:
 *
 *   1. Outbound economics — the swap OUTPUT must cover the destination chain's
 *      outbound fee (×BUFFER). We value that floor in RUNE via the dest
 *      gas-asset pool, then convert back to the `from` asset via its pool —
 *      `minIn = outbound_fee × BUFFER × price(destGas)/price(from)`.
 *   2. Source dust threshold — THORChain rejects an INPUT below the source
 *      chain's `dust_threshold` ("amount less than dust threshold") before
 *      economics even apply (e.g. DOGE's threshold is ~1 DOGE). It is
 *      denominated in the source chain's gas asset and converted into the
 *      `from` asset (identity when `from` IS the gas asset).
 *
 * The returned minimum is `max(constraint1, constraint2)` so it holds whichever
 * way the swap would be rejected. A spot-price conversion is sufficient because
 * slippage is negligible at minimum sizes.
 *
 * Returns `null` (never throws) when the minimum can't be determined —
 * MayaChain (CACAO economics differ), a destination chain absent from
 * `inbound_addresses`, a missing pool, or any fetch error. Callers treat
 * `null` as "no proactive signal" and fall back to provider errors.
 */
export const getNativeSwapMinAmountIn = async (
  {
    from,
    to,
    swapChain,
  }: {
    from: AccountCoin
    to: AccountCoin
    swapChain: NativeSwapChain
  },
  deps: NativeSwapMinDeps = {}
): Promise<NativeSwapMinAmountIn | null> => {
  // MayaChain (CACAO-denominated economics) is intentionally out of scope for
  // v1 — the THORChain minimum is the binding one for the reported repro.
  if (swapChain !== Chain.THORChain) {
    return null
  }

  // Both legs must be THORChain-routable for the asset notation / chain codes
  // below to resolve. Anything else has no native minimum to compute.
  if (!isOneOf(to.chain, nativeSwapEnabledChains) || !isOneOf(from.chain, nativeSwapEnabledChains)) {
    return null
  }

  try {
    const injected = deps.fetchInboundAddresses !== undefined || deps.fetchPools !== undefined

    const loadInbound = deps.fetchInboundAddresses ?? getThorchainInboundAddress
    const loadPools = deps.fetchPools ?? (() => getThorchainPools({ status: null }))

    let inbound: Awaited<ReturnType<typeof getThorchainInboundAddress>>
    let pools: ThorchainPoolSummary[]
    if (injected) {
      ;[inbound, pools] = await Promise.all([loadInbound(), loadPools()])
    } else {
      inboundCache = cached(inboundCache, loadInbound)
      poolsCache = cached(poolsCache, loadPools)
      ;[inbound, pools] = await Promise.all([inboundCache.value, poolsCache.value])
    }

    const destChainId = nativeSwapChainIds[to.chain]
    const destInfo = inbound.find(info => info.chain === destChainId)
    if (!destInfo) {
      return null
    }

    const outboundFee = Number(destInfo.outbound_fee)
    if (!Number.isFinite(outboundFee) || outboundFee <= 0) {
      return null
    }

    const poolByAsset = new Map(pools.map(pool => [pool.asset.toUpperCase(), pool]))

    // Price of one asset base unit in RUNE base units (both 1e8). RUNE = 1.
    const priceInRune = (assetId: string): number | null => {
      const upper = assetId.toUpperCase()
      if (upper === 'THOR.RUNE') {
        return 1
      }
      const pool = poolByAsset.get(upper)
      if (!pool) {
        return null
      }
      const rune = Number(pool.runeDepth)
      const asset = Number(pool.assetDepth)
      if (!Number.isFinite(rune) || !Number.isFinite(asset) || asset <= 0) {
        return null
      }
      return rune / asset
    }

    // `outbound_fee` is denominated in the destination chain's gas (fee) asset.
    const destGasAssetId = `${destChainId}.${chainFeeCoin[to.chain].ticker}`
    const fromAssetId = toNativeSwapAsset(from)

    const priceGas = priceInRune(destGasAssetId)
    const priceFrom = priceInRune(fromAssetId)
    if (priceGas === null || priceFrom === null || priceFrom <= 0) {
      return null
    }

    // Constraint 1 — outbound economics. The minimum output value (in RUNE) the
    // input must clear, converted back to `from`.
    const outboundMinInThorUnits = (outboundFee * NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER * priceGas) / priceFrom

    // Constraint 2 — source dust threshold. Denominated in the source chain's
    // gas asset (1e8 thor units); convert into the `from` asset — identity when
    // `from` IS the gas asset, otherwise via the source gas-asset pool. Absent
    // source-chain inbound info or a zero threshold contributes nothing.
    const fromChainId = nativeSwapChainIds[from.chain]
    const fromInfo = inbound.find(info => info.chain === fromChainId)
    const fromGasAssetId = `${fromChainId}.${chainFeeCoin[from.chain].ticker}`
    const dustThreshold = fromInfo ? Number(fromInfo.dust_threshold) : 0

    let dustMinInThorUnits = 0
    if (Number.isFinite(dustThreshold) && dustThreshold > 0) {
      if (fromAssetId.toUpperCase() === fromGasAssetId.toUpperCase()) {
        dustMinInThorUnits = dustThreshold
      } else {
        const priceFromGas = priceInRune(fromGasAssetId)
        if (priceFromGas !== null) {
          dustMinInThorUnits = (dustThreshold * priceFromGas) / priceFrom
        }
      }
    }

    // The input must satisfy BOTH constraints — the binding one is the larger.
    const minInThorUnits = Math.max(outboundMinInThorUnits, dustMinInThorUnits)
    const minHuman = minInThorUnits / 10 ** THORCHAIN_BASE_DECIMALS
    if (!Number.isFinite(minHuman) || minHuman <= 0) {
      return null
    }

    // Full-precision base units (bigint via parseUnits) for exact comparison,
    // plus a short rounded string for display.
    const minHumanFixed = minHuman.toFixed(from.decimals)
    const minAmountInBaseUnits = toChainAmount(minHumanFixed, from.decimals)

    return {
      swapChain,
      minAmountInBaseUnits,
      minAmountInHuman: formatMinForDisplay(minHuman),
      outboundFeeBaseUnit: destInfo.outbound_fee,
      dustThresholdBaseUnit: fromInfo?.dust_threshold,
      binding: dustMinInThorUnits > outboundMinInThorUnits ? 'dust' : 'outbound',
    }
  } catch {
    return null
  }
}

/** Render the minimum with ~4 significant digits and no trailing zero noise. */
const formatMinForDisplay = (value: number): string => {
  const precise = value < 1 ? value.toPrecision(2) : value.toPrecision(4)
  return String(Number(precise))
}
