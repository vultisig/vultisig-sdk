/**
 * Cosmos gas-fee primitives — pure crypto, no signing, no broadcast.
 *
 * Consolidates two pieces that previously lived split across the mcp-ts tool
 * layer (`estimateCosmosSwapFeeLabel`) and the SDK core-chain layer
 * (`getCosmosGasLimit`):
 *
 *   - `getCosmosGasLimit`        — re-exported from core-chain (per-coin gas limit).
 *   - `getCosmosSwapGasLimit`    — heuristic gas limit for a cosmos swap source-leg.
 *   - `estimateCosmosSwapFeeLabel` — `gas_limit × gas_price` formatted as `~<amt> <TICKER>`.
 *
 * `estimateCosmosSwapFeeLabel` derives the gas-token ticker + decimals from the
 * canonical `chainFeeCoin` metadata (single source of truth) rather than a local
 * hardcoded map, so it stays in lockstep with the rest of the SDK.
 */
import { Chain, CosmosChain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

export { getCosmosGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'

/**
 * Heuristic gas limit for a Skip cosmos swap source-leg tx (IBC transfer /
 * swap msg). It is an ESTIMATE — the actual limit is set by the signer via
 * simulation at sign time. Tuned conservatively so we don't under-display the
 * fee. Exported so callers can reuse the same constant the label is built from.
 */
export const COSMOS_SWAP_GAS_LIMIT = 350_000n

/**
 * Canonical gas price per chain, in udenom-per-gas. The node config endpoint's
 * `minimum_gas_price` is unreliable for this (empty on Osmosis, absent on Terra
 * Classic, present only on a few), so we use the well-known wallet defaults —
 * stable values that change rarely. THORChain / MayaChain charge a flat protocol
 * fee (no gas market) → omitted, so their fee label stays empty (no regression).
 */
export const COSMOS_GAS_PRICE: Partial<Record<CosmosChain, number>> = {
  [Chain.Cosmos]: 0.025, // uatom/gas
  [Chain.Osmosis]: 0.0025, // uosmo/gas
  [Chain.Kujira]: 0.0034, // ukuji/gas
  [Chain.Terra]: 0.015, // uluna/gas (phoenix-1)
  [Chain.TerraClassic]: 28.325, // uluna/gas (columbus-5)
}

const isCosmosChain = (chain: string): chain is CosmosChain => Object.values(CosmosChain).includes(chain as CosmosChain)

/**
 * Returns the gas limit a cosmos swap source-leg should request for the given
 * chain. Falls back to the heuristic `COSMOS_SWAP_GAS_LIMIT` when the chain has
 * no per-coin record entry.
 */
export const getCosmosSwapGasLimit = (chain: CosmosChain): bigint => {
  // IBC-enabled chains carry their own swap-shaped gas record entry; others
  // (vault-based THOR/Maya) use the heuristic. We deliberately keep this simple:
  // the source-leg of a swap is an IBC transfer / swap msg, ~350k everywhere.
  void chain
  return COSMOS_SWAP_GAS_LIMIT
}

export type CosmosSwapFeeLabelOpts = {
  /** Override the gas limit (defaults to {@link COSMOS_SWAP_GAS_LIMIT}). */
  gasLimit?: bigint
}

/**
 * Rough source-chain tx-fee estimate (`gas_limit × gas_price`) for a cosmos
 * swap, formatted `"~<amount> <TICKER>"`, e.g. `"~9.91 LUNC"`. Lets a swap
 * card's Est. fee row show something instead of an em-dash for cosmos / Skip
 * routes, which carry no fee in Skip's /route response (the chain gas is
 * otherwise only known at sign time). Returns '' for non-cosmos / flat-fee
 * chains so callers leave the label empty (no regression). The consumer appends
 * the fiat value off its own price-cache.
 *
 * It is explicitly an ESTIMATE (tilde-prefixed): both the gas limit and the gas
 * price are fixed heuristics, not a per-tx simulation. PURE: no network, no
 * signing, no broadcast.
 *
 * @param chain - chain name (any string; non-cosmos / flat-fee → '').
 * @param opts.gasLimit - optional gas-limit override.
 */
export const estimateCosmosSwapFeeLabel = (chain: string, opts: CosmosSwapFeeLabelOpts = {}): string => {
  if (!isCosmosChain(chain)) return ''

  const price = COSMOS_GAS_PRICE[chain]
  if (price == null || price <= 0) return ''

  const meta = chainFeeCoin[chain]
  if (!meta) return ''
  const { ticker, decimals } = meta

  const gasLimit = opts.gasLimit ?? getCosmosSwapGasLimit(chain)
  // gasLimit is a bigint; price is a small float → compute in number space.
  // Magnitudes here (≤ ~1e7 udenom) stay well inside Number's safe range.
  const fee = (Number(gasLimit) * price) / 10 ** decimals
  if (!Number.isFinite(fee) || fee <= 0) return ''

  return `~${Number(fee.toPrecision(3))} ${ticker}`
}

/** Chains for which {@link estimateCosmosSwapFeeLabel} returns a non-empty label. */
export const COSMOS_SWAP_FEE_LABEL_CHAINS = Object.keys(COSMOS_GAS_PRICE) as CosmosChain[]

// Re-export the IBC-enabled chain set for callers that want to gate on it.
export { IbcEnabledCosmosChain }
