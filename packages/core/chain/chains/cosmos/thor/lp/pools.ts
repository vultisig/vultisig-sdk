import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

/**
 * Midgard base URL used by every helper in this module. Matches what
 * vultisig-ios and the rujira package use as the default mainnet endpoint.
 */
export const THORCHAIN_MIDGARD_BASE_URL = 'https://midgard.ninerealms.com'

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
      ? `${THORCHAIN_MIDGARD_BASE_URL}/v2/pools`
      : `${THORCHAIN_MIDGARD_BASE_URL}/v2/pools?status=${encodeURIComponent(status)}`
  const raw = await queryUrl<RawPool[]>(url)
  return raw.map(normalizePool)
}
