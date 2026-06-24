/**
 * Cosmos gas-fee primitives — pure crypto, no signing, no broadcast.
 *
 * Consolidates two pieces that previously lived split across the mcp-ts tool
 * layer (`estimateCosmosSwapFeeLabel`) and the SDK core-chain layer
 * (`getCosmosGasLimit`):
 *
 *   - `getCosmosGasLimit`        — re-exported from core-chain (per-coin gas limit).
 *   - `getCosmosSwapGasLimit`    — heuristic gas limit for a cosmos swap source-leg.
 *   - `estimateCosmosSwapFeeLabel` — canonical per-chain swap fee formatted `~<amt> <TICKER>`.
 *
 * `estimateCosmosSwapFeeLabel` reads the fee amount from the SDK's own canonical
 * `cosmosGasRecord` (the exact base-unit fee the cosmos signer charges — the same
 * floor `getCosmosFeeAmount` / `buildCosmosPayload` use) and the ticker/decimals
 * from `chainFeeCoin` metadata, so the displayed estimate is the single source of
 * truth shared with the send/swap fee path and cannot drift below the real
 * sign-time fee. This mirrors the canonical mcp-ts implementation
 * (`src/tools/fee/gas-price.ts`, `COSMOS_SEND_FEE_BASE_UNITS`).
 */
import { CosmosChain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { cosmosGasRecord } from '@vultisig/core-chain/chains/cosmos/gas'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

export { getCosmosGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'

/**
 * Heuristic gas limit for a Skip cosmos swap source-leg tx (IBC transfer /
 * swap msg). It is an ESTIMATE — the actual limit is set by the signer via
 * simulation at sign time. Exported so callers can reuse the same constant.
 */
export const COSMOS_SWAP_GAS_LIMIT = 350_000n

const isCosmosChain = (chain: string): chain is CosmosChain => Object.values(CosmosChain).includes(chain as CosmosChain)

const hasCanonicalFee = (chain: CosmosChain): chain is IbcEnabledCosmosChain => chain in cosmosGasRecord

/**
 * Returns the heuristic gas limit a cosmos swap source-leg should request. This
 * is chain-invariant by design: the source-leg of a swap is an IBC transfer /
 * swap msg (~350k everywhere) and the real limit is set by the signer at sign
 * time via simulation. Exposed for callers that build the limit themselves.
 */
export const getCosmosSwapGasLimit = (_chain: CosmosChain): bigint => COSMOS_SWAP_GAS_LIMIT

/**
 * Render a base-unit fee amount (bigint) as a plain decimal string at `decimals`
 * places, trailing-zero-trimmed — no exponential notation (unlike
 * `Number.toPrecision`, which emits `9.99e-7` for tiny values).
 * e.g. (9000n, 6) → "0.009"; (100000000n, 6) → "100".
 */
const formatBaseUnits = (baseUnits: bigint, decimals: number): string => {
  if (decimals === 0) return baseUnits.toString()
  const s = baseUnits.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

/**
 * Source-chain tx-fee estimate for a cosmos swap, formatted `"~<amount> <TICKER>"`,
 * e.g. `"~100 LUNC"`. Lets a swap card's Est. fee row show something instead of an
 * em-dash for cosmos / Skip routes, which carry no fee in Skip's /route response
 * (the chain gas is otherwise only known at sign time). Returns '' for non-cosmos
 * / flat-fee chains (THORChain / MayaChain have no gas market) so callers leave the
 * label empty (no regression). The consumer appends the fiat value off its own
 * price-cache.
 *
 * The amount is the SAME canonical per-chain fee the SDK signer actually charges
 * (`cosmosGasRecord`), so the displayed estimate cannot drift below the real
 * sign-time fee — a 10x under-display on e.g. TerraClassic's 100 LUNC would badly
 * mislead the user. It is explicitly an ESTIMATE (tilde-prefixed). PURE: no
 * network, no signing, no broadcast.
 *
 * @param chain - chain name (any string; non-cosmos / flat-fee → '').
 */
export const estimateCosmosSwapFeeLabel = (chain: string): string => {
  if (!isCosmosChain(chain) || !hasCanonicalFee(chain)) return ''

  const fee = cosmosGasRecord[chain]
  if (fee == null || fee <= 0n) return ''

  const meta = chainFeeCoin[chain]
  if (!meta) return ''

  return `~${formatBaseUnits(fee, meta.decimals)} ${meta.ticker}`
}

/** Chains for which {@link estimateCosmosSwapFeeLabel} returns a non-empty label. */
export const COSMOS_SWAP_FEE_LABEL_CHAINS = Object.keys(cosmosGasRecord) as IbcEnabledCosmosChain[]

// Re-export the IBC-enabled chain set for callers that want to gate on it.
export { IbcEnabledCosmosChain }
