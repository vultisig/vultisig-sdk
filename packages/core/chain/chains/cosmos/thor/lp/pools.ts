import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

/**
 * Midgard base URL used by every helper in this module. Matches what
 * vultisig-ios and the rujira package use as the default mainnet endpoint.
 */
export const thorchainMidgardBaseUrl = 'https://midgard.thorchain.network'

/**
 * Canonical THORChain pool-id format: `CHAIN.ASSET` for native assets
 * (e.g. `BTC.BTC`, `ETH.ETH`) or `CHAIN.ASSET-CONTRACT` for ERC-20-style
 * tokens (e.g. `ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48`).
 *
 * THORChain itself stores pool ids in uppercase. Lowercase variants
 * round-trip through Midgard but several internal lookups (and the
 * thornode `/thorchain/pool/{asset}` endpoint) are case-sensitive on the
 * chain prefix and contract section, so we enforce uppercase + the
 * documented separators here to fail fast on typos.
 *
 * Examples accepted:
 *   BTC.BTC
 *   LTC.LTC
 *   ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48
 *   BSC.BNB
 *
 * Examples rejected:
 *   "btc.btc" (lowercase)
 *   "BTC/BTC" (wrong separator)
 *   "BTC" (no asset section)
 *   "BTC.BTC.BTC" (extra section)
 */
const POOL_ID_RE = /^[A-Z0-9]+\.[A-Z0-9]+(-[A-Z0-9]+)?$/

/**
 * Validate a THORChain pool id is in the canonical format.
 *
 * Throws `Error` with the offending value embedded so callers up the
 * stack can surface it to the user. Use this at every public entry
 * point that accepts a pool id from the LLM or external code: it is
 * cheaper than discovering at the build / broadcast / Midgard call
 * that the id is malformed.
 */
export const assertValidPoolId = (pool: string): void => {
  if (typeof pool !== 'string' || pool.length === 0) {
    throw new Error(
      `assertValidPoolId: pool id must be a non-empty string, got ${typeof pool} ${pool === '' ? '""' : ''}`
    )
  }
  if (!POOL_ID_RE.test(pool)) {
    throw new Error(
      `assertValidPoolId: ${JSON.stringify(pool)} is not a valid THORChain pool id. ` +
        `Expected uppercase CHAIN.ASSET (e.g. "BTC.BTC") or CHAIN.ASSET-CONTRACT ` +
        `(e.g. "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48").`
    )
  }
}

/**
 * Boolean variant of `assertValidPoolId` for callers that just want to
 * filter / branch instead of throwing.
 */
export const isValidPoolId = (pool: string): boolean => {
  if (typeof pool !== 'string' || pool.length === 0) return false
  return POOL_ID_RE.test(pool)
}

/**
 * Subset of the Midgard `/v2/pools` shape that the agent stack actually
 * cares about. The full Midgard response carries dozens of fields per pool;
 * we narrow to the ones the LLM needs to pick a pool and present quotes.
 */
export type ThorchainPoolSummary = {
  asset: string
  status: string
  assetDepth: string
  runeDepth: string
  liquidityUnits: string
  volume24h: string
  annualPercentageRate: string
}

type RawPool = {
  asset?: string
  status?: string
  assetDepth?: string
  runeDepth?: string
  liquidityUnits?: string
  volume24h?: string
  annualPercentageRate?: string
}

const normalizePool = (raw: RawPool): ThorchainPoolSummary => ({
  asset: raw.asset ?? '',
  status: raw.status ?? '',
  assetDepth: raw.assetDepth ?? '0',
  runeDepth: raw.runeDepth ?? '0',
  liquidityUnits: raw.liquidityUnits ?? '0',
  volume24h: raw.volume24h ?? '0',
  annualPercentageRate: raw.annualPercentageRate ?? '0',
})

export type GetThorchainPoolsOptions = {
  /** Defaults to `'available'`. Pass `null` to skip the filter. */
  status?: string | null
}

/**
 * Fetch THORChain pools from Midgard.
 *
 * By default returns only `status=available` pools — the only ones that
 * accept LP adds. Pass `{ status: null }` to fetch every pool regardless.
 */
export const getThorchainPools = async (
  options: GetThorchainPoolsOptions = {}
): Promise<ThorchainPoolSummary[]> => {
  const status = options.status === undefined ? 'available' : options.status
  const url =
    status === null
      ? `${thorchainMidgardBaseUrl}/v2/pools`
      : `${thorchainMidgardBaseUrl}/v2/pools?status=${encodeURIComponent(status)}`
  const raw = await queryUrl<unknown>(url)
  if (!Array.isArray(raw)) {
    throw new Error(
      `getThorchainPools: expected an array from ${url}, got ${typeof raw}`
    )
  }
  return (raw as RawPool[]).map(normalizePool)
}
