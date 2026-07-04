import { Chain, type UtxoChain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'

/**
 * UTXO fee-rate primitive (sat/vB) ported from mcp-ts
 * `src/tools/fee/utxo-fees.ts` (0 SDK imports there — pure crypto/read).
 *
 * Source of truth is the THORChain / MayaChain `inbound_addresses`
 * endpoint, which publishes the recommended on-chain `gas_rate` per
 * supported UTXO chain. This is the same rate the swap rail uses when
 * building UTXO KeysignPayloads, so consumers that build sends /
 * consolidations get a fee rate consistent with the network the swapper
 * would broadcast against.
 */

// THORChain / MayaChain node URLs. Exported so sibling primitives
// (utxo consolidate / split) can reuse the same fee-rate source without
// duplicating URL strings. Sourced from core-chain's canonical
// `cosmosRpcUrl` so this primitive tracks host migrations (e.g. the
// THORChain REST move to the Liquify gateway) instead of pinning a legacy
// host that can be decommissioned out from under us.
export const THORCHAIN_NODE_URL = cosmosRpcUrl[Chain.THORChain]
export const MAYACHAIN_NODE_URL = cosmosRpcUrl[Chain.MayaChain]

const DEFAULT_TIMEOUT_MS = 15_000

type InboundAddress = {
  chain: string
  gas_rate: string
  halted: boolean
}

/**
 * Per UTXO chain: which inbound source publishes its fee rate and under
 * what chain key. Bitcoin / Litecoin / Dogecoin / Bitcoin-Cash live on
 * THORChain; Dash lives on MayaChain (not available on THORChain).
 *
 * Zcash is intentionally OMITTED. Zcash does not use a sat/vB fee model —
 * it uses ZIP-317 conventional fees (zats per logical action), computed
 * client-side (see `core-chain/chains/utxo/fee/zip317.ts` +
 * `getUtxoByteFee`, which hardcodes Zcash to 100 sat/byte to clear the
 * ZIP-317 floor). MayaChain's published ZEC `gas_rate` is NOT a per-vByte
 * rate — at the time of writing it reads `127500`, which as a "sat/vB" rate
 * would build a tx that burns the entire balance in fees. Returning it under
 * a `feeRateUnit: 'sat/vB'` envelope would be silently, dangerously wrong.
 * The swap rail (`resolveUtxoFeeRate`) and mcp-ts (no `zec_fee_rate` tool)
 * omit Zcash for the same reason; callers needing a Zcash fee must use the
 * ZIP-317 path. `utxoFeeRate('Zcash')` therefore throws "Unsupported".
 */
type FeeRateSource = { nodeUrl: string; chainKey: string; isMaya: boolean }
const utxoFeeRateSource: Partial<Record<UtxoChain, FeeRateSource>> = {
  Bitcoin: { nodeUrl: THORCHAIN_NODE_URL, chainKey: 'BTC', isMaya: false },
  Litecoin: { nodeUrl: THORCHAIN_NODE_URL, chainKey: 'LTC', isMaya: false },
  Dogecoin: { nodeUrl: THORCHAIN_NODE_URL, chainKey: 'DOGE', isMaya: false },
  'Bitcoin-Cash': { nodeUrl: THORCHAIN_NODE_URL, chainKey: 'BCH', isMaya: false },
  Dash: { nodeUrl: MAYACHAIN_NODE_URL, chainKey: 'DASH', isMaya: true },
}

async function fetchInboundAddresses(nodeUrl: string, isMaya: boolean): Promise<InboundAddress[]> {
  const path = isMaya ? '/mayachain/inbound_addresses' : '/thorchain/inbound_addresses'
  // Hermes-compatible timeout: `AbortSignal.timeout()` is Node 17.3+ and not
  // available on older RN/Hermes runtimes (this primitive is RN-exported), so
  // build the same behaviour with AbortController + setTimeout — mirrors
  // `src/chains/tron/rpc.ts`.
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`utxoFeeRate timeout after ${DEFAULT_TIMEOUT_MS}ms: ${nodeUrl}${path}`)),
    DEFAULT_TIMEOUT_MS
  )
  try {
    const res = await fetch(`${nodeUrl}${path}`, { signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${nodeUrl}${path}: ${body.substring(0, 200)}`)
    }
    return (await res.json()) as InboundAddress[]
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Resolve the recommended fee rate (sat/vB) for a chain key from a given
 * inbound source. Throws on a halted chain or a non-positive `gas_rate`
 * rather than returning a zero-fee envelope that would never confirm —
 * mirrors the gating mcp-ts uses (NeOMakinG #113) and the swap rail's
 * `resolveUtxoFeeRate` halt check.
 */
async function resolveFeeRate(nodeUrl: string, chainKey: string, isMaya: boolean): Promise<number> {
  const inbounds = await fetchInboundAddresses(nodeUrl, isMaya)
  const entry = inbounds.find(i => i.chain === chainKey)
  if (!entry) {
    throw new Error(`No fee rate found for ${chainKey}`)
  }
  if (entry.halted) {
    throw new Error(`chain ${chainKey} is currently halted on the inbound source — cannot compute fee rate`)
  }
  // Strict integer parse — `parseInt` silently truncates (`'10.5'` -> 10,
  // `'1e3'` -> 1, `'15px'` -> 15), which for a fee rate means a quietly-wrong
  // number instead of failing closed. The inbound source publishes integer
  // sat/(v)byte rates; anything else is a malformed response we should reject.
  const raw = entry.gas_rate.trim()
  const rate = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`chain ${chainKey} returned non-positive gas_rate ${entry.gas_rate} — cannot compute fee rate`)
  }
  return rate
}

export type UtxoFeeRate = {
  /** UTXO chain (SDK `UtxoChain` value, e.g. `'Bitcoin'`). */
  chain: UtxoChain
  /** Recommended fee rate. */
  feeRate: number
  /** Unit of `feeRate`. Always `'sat/vB'` for UTXO chains. */
  feeRateUnit: 'sat/vB'
}

/**
 * Get the recommended UTXO fee rate (sat/vB) for a chain.
 *
 * @example
 * ```ts
 * const { feeRate } = await utxoFeeRate('Bitcoin')
 * // => { chain: 'Bitcoin', feeRate: 7, feeRateUnit: 'sat/vB' }
 * ```
 *
 * @throws if the chain is halted on the inbound source or returns a
 *         non-positive `gas_rate` (never silently yields a zero fee).
 */
export const utxoFeeRate = async (chain: UtxoChain): Promise<UtxoFeeRate> => {
  const source = utxoFeeRateSource[chain]
  if (!source) {
    throw new Error(
      `Unsupported UTXO chain for sat/vB fee rate: ${chain}` +
        (chain === ('Zcash' as UtxoChain)
          ? ' (Zcash uses ZIP-317 conventional fees, not a sat/vB rate — use the ZIP-317 fee path)'
          : '')
    )
  }
  const feeRate = await resolveFeeRate(source.nodeUrl, source.chainKey, source.isMaya)
  return { chain, feeRate, feeRateUnit: 'sat/vB' }
}
