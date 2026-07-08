import { Chain } from '../../Chain'
import { getFeeAmountFromGasPrice, type ParsedDecimal, parseDecimal } from './cosmosDecimal'
import { getCosmosRpcUrl } from './getCosmosRpcUrl'

/**
 * Osmosis runs an EIP-1559-style dynamic base fee (`x/txfees` module): the
 * real minimum required fee floats and is enforced at the protocol/consensus
 * level, separate from a node's own locally-configured `minimum-gas-prices`
 * (the generic `/cosmos/base/node/v1beta1/config` value `getCosmosFeeAmount`
 * otherwise queries for every ibc-enabled chain). A tx priced against only
 * the generic node config can still be rejected at broadcast with sdk error
 * code 13 ("insufficient fees") when the live EIP-1559 base fee has risen
 * above it.
 *
 * Live-verified in production (vultiagent-app): a broadcast failed with
 * "base fee was 0.03 -> required 12000uosmo" - the generic min-gas-price
 * mechanism did not reflect the real floor.
 *
 * Query Osmosis's own `cur_eip_base_fee` endpoint directly and apply
 * headroom, rather than relying on the generic node-config value.
 *
 * Trust boundary (review finding, 2026-07-08): this floor feeds directly
 * into the SIGNABLE fee, so a compromised/malfunctioning/MITM'd LCD (this
 * endpoint honors a user-configured RPC override) returning a pathological
 * `base_fee` must never (a) inflate the signable fee unboundedly, or (b)
 * crash fee resolution outright (violating the fail-open contract every
 * other error path here honors). Both are closed by computing the floor
 * with exact rational arithmetic (no IEEE-754 `Number`, so no
 * overflow-to-Infinity path) and clamping the result to a generous sanity
 * ceiling before returning it.
 */
const OSMOSIS_BASE_FEE_HEADROOM: ParsedDecimal = { numerator: 5n, denominator: 4n } // 1.25x, exact
// Hard ceiling on the base-fee lookup: fail-open only covers ERRORS - a
// stalled txfees LCD (TCP up, no bytes) would otherwise hang the fee
// resolution indefinitely.
const OSMOSIS_BASE_FEE_TIMEOUT_MS = 5_000
// Sanity backstop on the computed floor itself, independent of the fetch
// succeeding: the live-verified real incident this guards against needed
// ~12_000 uosmo against a 9_000n static floor (~1.3x) - 1000x is enormous
// headroom above any realistic base-fee spike while still bounding a
// pathological/malicious LCD response (e.g. a `base_fee` of "1000" would
// otherwise compute a ~375 OSMO fee for a standard send).
const OSMOSIS_DYNAMIC_FLOOR_MAX_MULTIPLIER = 1_000n
const OSMOSIS_STATIC_FLOOR = 9_000n // must match cosmosGasRecord[Chain.Osmosis] in gas.ts

type OsmosisBaseFeeResponse = {
  base_fee?: string
}

type FetchOpts = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

async function fetchOsmosisBaseFeePerGas({ fetchImpl = fetch, signal }: FetchOpts = {}): Promise<ParsedDecimal | null> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), OSMOSIS_BASE_FEE_TIMEOUT_MS)
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    const rejectTimeout = () => reject(new Error('Osmosis base-fee request timed out'))
    if (controller.signal.aborted) {
      rejectTimeout()
      return
    }
    controller.signal.addEventListener('abort', rejectTimeout, { once: true })
  })

  try {
    const body = await Promise.race([
      (async () => {
        const res = await fetchImpl(`${getCosmosRpcUrl(Chain.Osmosis)}/osmosis/txfees/v1beta1/cur_eip_base_fee`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Osmosis base-fee request failed: ${res.status}`)
        return (await res.json()) as OsmosisBaseFeeResponse
      })(),
      timeoutPromise,
    ])

    const baseFee = body?.base_fee
    if (typeof baseFee !== 'string') return null

    // Exact rational parse - no `Number()` coercion, so no path to
    // overflow-to-Infinity on a pathologically long-but-regex-valid string.
    return parseDecimal(baseFee) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Live fee floor for Osmosis (base-denom units for `gasLimit`), or null when
 * the lookup failed OR the computed floor exceeds the sanity ceiling
 * (fail-open in both cases - caller should fall back to its own static or
 * generically-derived fee).
 */
export async function getOsmosisDynamicFeeFloor(gasLimit: bigint, opts: FetchOpts = {}): Promise<bigint | null> {
  const baseFee = await fetchOsmosisBaseFeePerGas(opts)
  if (baseFee === null) return null

  const withHeadroom: ParsedDecimal = {
    numerator: baseFee.numerator * OSMOSIS_BASE_FEE_HEADROOM.numerator,
    denominator: baseFee.denominator * OSMOSIS_BASE_FEE_HEADROOM.denominator,
  }
  const fee = getFeeAmountFromGasPrice(gasLimit, withHeadroom)

  if (fee > OSMOSIS_STATIC_FLOOR * OSMOSIS_DYNAMIC_FLOOR_MAX_MULTIPLIER) return null

  return fee
}
