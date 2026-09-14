import { EvmChain } from '@vultisig/core-chain/Chain'

import { evmGasPrice } from '../evm/gasPrice'

/**
 * Gas units consumed by the supported tx archetypes. A plain native/ERC-20
 * transfer is the canonical 21k; a typical DEX swap is ~150k. These mirror the
 * heuristics used by mcp-ts `compare_gas_costs` so the two surfaces agree.
 */
export const GAS_UNITS = {
  transfer: 21_000,
  swap: 150_000,
} as const

export type GasTxType = keyof typeof GAS_UNITS

/** The 7 major EVM networks queried when no explicit chain list is given. */
export const DEFAULT_COMPARE_CHAINS: EvmChain[] = [
  EvmChain.Ethereum,
  EvmChain.Arbitrum,
  EvmChain.Optimism,
  EvmChain.Base,
  EvmChain.Polygon,
  EvmChain.BSC,
  EvmChain.Avalanche,
]

export type CompareCostsParams = {
  /** Chains to compare. Defaults to {@link DEFAULT_COMPARE_CHAINS}. */
  chains?: EvmChain[]
  /** Tx archetype to price (gas units). Defaults to `'transfer'`. */
  txType?: GasTxType
  /**
   * Optional native-token USD prices keyed by chain. When supplied for a chain,
   * `estTxCostUsd` is filled in (pure multiply — no network fetch). Omit to get
   * gwei-only comparison. Pricing is deliberately injected, not fetched, so this
   * primitive stays a pure fee-math + RPC-read with zero external-API coupling.
   */
  nativeUsdPrices?: Partial<Record<EvmChain, number>>
}

export type CompareCostsEntry = {
  chain: EvmChain
  /** Display-only gas price in gwei (4 dp; positive prices have a 0.0001 minimum). */
  gasPriceGwei: number
  /** Native-token USD price if provided in `nativeUsdPrices`, else `null`. */
  nativeUsd: number | null
  /** Estimated native-token cost from raw wei × gasUnits, independent of display rounding. */
  estTxCostNative: number
  /** Estimated USD cost rounded to 6 dp for display when priced, else `null`. */
  estTxCostUsd: number | null
}

export type CompareCostsSkipped = {
  chain: EvmChain
  error: string
}

export type CompareCostsResult = {
  txType: GasTxType
  gasUnits: number
  /** Chains ranked cheapest-first by native tx cost (USD when all priced). */
  results: CompareCostsEntry[]
  /** The cheapest entry, or `null` when every chain errored. */
  cheapest: Pick<CompareCostsEntry, 'chain' | 'estTxCostNative' | 'estTxCostUsd'> | null
  /** Chains that errored during the RPC read (fail-soft — never throws). */
  skipped: CompareCostsSkipped[]
}

/** Fetch the current gas price (gwei, 4 dp) for a single EVM chain. */
export const getChainGasPriceGwei = async (chain: EvmChain): Promise<number> => {
  const { gasPriceGwei } = await evmGasPrice(chain)
  return gasPriceGwei
}

/**
 * Fan out the current gas price across a set of EVM chains and rank them
 * cheapest-first by estimated transaction cost. Pure fee math over `eth_gasPrice`
 * reads — fail-soft per chain (a failing RPC lands in `skipped`, never rejects
 * the whole call).
 *
 * @example
 * ```ts
 * const cmp = await compareCosts({ chains: ['Ethereum', 'Base', 'Arbitrum'] })
 * cmp.results.forEach(r => console.log(r.chain, r.gasPriceGwei, 'gwei'))
 * // cmp.cheapest => { chain: 'Base', estTxCostNative: ..., estTxCostUsd: null }
 * ```
 */
export const compareCosts = async (params: CompareCostsParams = {}): Promise<CompareCostsResult> => {
  const chains = params.chains && params.chains.length > 0 ? params.chains : DEFAULT_COMPARE_CHAINS
  const txType: GasTxType = params.txType ?? 'transfer'
  const gasUnits = GAS_UNITS[txType]
  const prices = params.nativeUsdPrices ?? {}

  const settlements = await Promise.allSettled(chains.map(chain => evmGasPrice(chain)))

  const results: CompareCostsEntry[] = []
  const skipped: CompareCostsSkipped[] = []

  settlements.forEach((settlement, i) => {
    const chain = chains[i]
    if (settlement.status === 'rejected') {
      const reason = settlement.reason
      skipped.push({
        chain,
        error: reason instanceof Error ? reason.message : String(reason),
      })
      return
    }

    const { gasPriceWei, gasPriceGwei } = settlement.value
    const estTxCostNative = Number(gasPriceWei * BigInt(gasUnits)) / 1e18
    const nativeUsd = prices[chain] ?? null
    const estTxCostUsd = nativeUsd !== null ? parseFloat((estTxCostNative * nativeUsd).toFixed(6)) : null

    results.push({ chain, gasPriceGwei, nativeUsd, estTxCostNative, estTxCostUsd })
  })

  // Rank cheapest-first on a SINGLE, consistent basis. USD is comparable across
  // chains (different native tokens), native cost is NOT (1e-4 ETH ≠ 1e-4 MATIC),
  // so we only USD-rank when EVERY surviving result is priced. A per-pair mix
  // (USD when both have it, native otherwise) is non-transitive and can crown a
  // USD-expensive chain as "cheapest" just because its native-token unit cost is
  // numerically small — so we never mix bases. With a partial price map we fall
  // back to native ordering wholesale (the documented gwei-only best-effort).
  // Use unrounded USD costs for ranking: the display values can tie at zero.
  const allPriced = results.length > 0 && results.every(r => r.estTxCostUsd !== null)
  results.sort((a, b) =>
    allPriced
      ? a.estTxCostNative * (a.nativeUsd as number) - b.estTxCostNative * (b.nativeUsd as number)
      : a.estTxCostNative - b.estTxCostNative
  )

  const cheapest =
    results.length > 0
      ? {
          chain: results[0].chain,
          estTxCostNative: results[0].estTxCostNative,
          estTxCostUsd: results[0].estTxCostUsd,
        }
      : null

  return { txType, gasUnits, results, cheapest, skipped }
}
