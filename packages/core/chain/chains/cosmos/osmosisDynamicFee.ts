import { Chain } from '../../Chain'
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
 */
const OSMOSIS_BASE_FEE_HEADROOM = 1.25
// Hard ceiling on the base-fee lookup: fail-open only covers ERRORS - a
// stalled txfees LCD (TCP up, no bytes) would otherwise hang the fee
// resolution indefinitely.
const OSMOSIS_BASE_FEE_TIMEOUT_MS = 5_000

type OsmosisBaseFeeResponse = {
  base_fee?: string
}

type FetchOpts = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

// Strict non-negative decimal (matches the shape Osmosis's LCD actually
// returns, e.g. "0.030000000000000000") - rejects null/empty/non-numeric/
// negative/exponential values rather than trusting `Number()`'s loose
// coercion (which turns `null`/`""`/`[]` into `0` and `true` into `1`).
const decimalPattern = /^\d+(?:\.\d+)?$/

async function fetchOsmosisBaseFeePerGas({ fetchImpl = fetch, signal }: FetchOpts = {}): Promise<number | null> {
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
    if (typeof baseFee !== 'string' || !decimalPattern.test(baseFee)) return null

    return Number(baseFee)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Live fee floor for Osmosis (base-denom units for `gasLimit`), or null when
 * the lookup failed (fail-open - caller should fall back to its own static
 * or generically-derived fee).
 */
export async function getOsmosisDynamicFeeFloor(gasLimit: bigint, opts: FetchOpts = {}): Promise<bigint | null> {
  const baseFee = await fetchOsmosisBaseFeePerGas(opts)
  if (baseFee === null) return null
  return BigInt(Math.ceil(Number(gasLimit) * baseFee * OSMOSIS_BASE_FEE_HEADROOM))
}
