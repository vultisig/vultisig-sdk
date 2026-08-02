import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { KnownCoin } from '@vultisig/core-chain/coin/Coin'
import { thorchainNativeTokensMetadata } from '@vultisig/core-chain/coin/knownTokens/thorchain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

export type ThorchainSecuredAsset = KnownCoin & {
  /** Canonical THORChain bank denom, e.g. `eth-usdc-0xa0b8…`. */
  id: string
  /** Canonical L1 pool asset, e.g. `ETH.USDC-0XA0B8…`. */
  l1Asset: string
  isSecured: true
  /** Live x/bank share supply. Omitted on the static offline fallback. */
  supply?: string
  /** Live underlying L1 depth. Omitted on the static offline fallback. */
  depth?: string
}

export type ThorchainSecuredAssetCatalog = {
  assets: ThorchainSecuredAsset[]
  source: 'thorchain' | 'fallback'
}

export type ThorchainSecuredAssetCatalogFetcher = (options?: {
  forceRefresh?: boolean
}) => Promise<ThorchainSecuredAssetCatalog>

export type ThorchainSwapDestinationAsset = KnownCoin & {
  isSecured?: true
  l1Asset?: string
}

type CreateThorchainSecuredAssetCatalogOptions = {
  baseUrl?: string
  cacheTtlMs?: number
  fetchJson?: (url: string) => Promise<unknown>
  fallbackAssets?: readonly ThorchainSecuredAsset[]
  now?: () => number
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const securedAssetsUrl = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/securedassets`

type RawSecuredAsset = {
  asset?: unknown
  supply?: unknown
  depth?: unknown
}

const parseSecuredDenom = (value: string): { denom: string; l1Asset: string; ticker: string } | null => {
  const denom = value.trim().toLowerCase()
  const separator = denom.indexOf('-')
  if (separator <= 0 || separator === denom.length - 1 || denom.includes('/') || denom.includes('.')) {
    return null
  }

  const chainPrefix = denom.slice(0, separator)
  const rest = denom.slice(separator + 1)
  if (
    !/^[a-z0-9]+$/i.test(chainPrefix) ||
    chainPrefix === 'thor' ||
    chainPrefix === 'maya' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(rest)
  ) {
    return null
  }

  const ticker = rest.split('-')[0].toUpperCase()
  return {
    denom,
    l1Asset: `${chainPrefix.toUpperCase()}.${rest.toUpperCase()}`,
    ticker,
  }
}

const fallbackMetadataByTicker = new Map<string, (typeof thorchainNativeTokensMetadata)[string]>()
for (const metadata of Object.values(thorchainNativeTokensMetadata)) {
  if (!fallbackMetadataByTicker.has(metadata.ticker.toUpperCase())) {
    fallbackMetadataByTicker.set(metadata.ticker.toUpperCase(), metadata)
  }
}

const toSecuredAsset = (value: string, status?: { supply: string; depth: string }): ThorchainSecuredAsset | null => {
  const parsed = parseSecuredDenom(value)
  if (!parsed) return null

  const exactFallback = thorchainNativeTokensMetadata[parsed.denom]
  const tickerFallback = fallbackMetadataByTicker.get(parsed.ticker)
  const metadata = exactFallback ?? tickerFallback

  return {
    chain: Chain.THORChain,
    id: parsed.denom,
    ticker: parsed.ticker,
    logo: metadata?.logo ?? parsed.ticker.toLowerCase(),
    decimals: 8,
    ...(metadata?.priceProviderId ? { priceProviderId: metadata.priceProviderId } : {}),
    l1Asset: parsed.l1Asset,
    isSecured: true,
    ...status,
  }
}

const parseNonNegativeInteger = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`THORChain secured-assets response contains an invalid ${field}`)
  }
  return value
}

export const parseThorchainSecuredAssets = (raw: unknown): ThorchainSecuredAsset[] => {
  if (!Array.isArray(raw)) {
    throw new Error(`THORChain secured-assets response must be an array, received ${typeof raw}`)
  }

  const result: ThorchainSecuredAsset[] = []
  const seen = new Set<string>()
  for (const entry of raw as RawSecuredAsset[]) {
    if (typeof entry?.asset !== 'string') {
      throw new Error('THORChain secured-assets response contains an entry without a string asset')
    }
    const asset = toSecuredAsset(entry.asset, {
      supply: parseNonNegativeInteger(entry.supply, 'supply'),
      depth: parseNonNegativeInteger(entry.depth, 'depth'),
    })
    if (!asset) {
      throw new Error(`THORChain returned an invalid secured asset: ${JSON.stringify(entry.asset)}`)
    }
    if (!seen.has(asset.id)) {
      seen.add(asset.id)
      result.push(asset)
    }
  }

  if (result.length === 0) {
    throw new Error('THORChain secured-assets response is empty')
  }

  return result
}

export const thorchainSecuredAssetFallback: readonly ThorchainSecuredAsset[] = Object.keys(
  thorchainNativeTokensMetadata
)
  .map(value => toSecuredAsset(value))
  .filter((asset): asset is ThorchainSecuredAsset => asset !== null)

const copyCatalog = (catalog: ThorchainSecuredAssetCatalog): ThorchainSecuredAssetCatalog => ({
  source: catalog.source,
  assets: catalog.assets.map(asset => ({ ...asset })),
})

/**
 * Creates a cached, coalescing THORChain secured-asset catalog reader.
 *
 * The live `/thorchain/securedassets` endpoint is authoritative. The static
 * SDK table is returned only when the live read is unavailable or malformed,
 * keeping destination discovery useful offline without presenting the fallback
 * as fresh chain state.
 */
export const createThorchainSecuredAssetCatalog = ({
  baseUrl = securedAssetsUrl,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  fetchJson = url => queryUrl<unknown>(url),
  fallbackAssets = thorchainSecuredAssetFallback,
  now = Date.now,
}: CreateThorchainSecuredAssetCatalogOptions = {}): ThorchainSecuredAssetCatalogFetcher => {
  let snapshot: { catalog: ThorchainSecuredAssetCatalog; expiresAt: number } | undefined
  let inFlight: Promise<ThorchainSecuredAssetCatalog> | undefined

  return async ({ forceRefresh = false } = {}) => {
    const currentTime = now()
    if (!forceRefresh && snapshot && currentTime < snapshot.expiresAt) {
      return copyCatalog(snapshot.catalog)
    }
    if (inFlight) {
      return copyCatalog(await inFlight)
    }

    inFlight = (async () => {
      let catalog: ThorchainSecuredAssetCatalog
      try {
        catalog = {
          assets: parseThorchainSecuredAssets(await fetchJson(baseUrl)),
          source: 'thorchain',
        }
      } catch {
        catalog = {
          assets: fallbackAssets.map(asset => ({ ...asset })),
          source: 'fallback',
        }
      }
      snapshot = {
        catalog,
        expiresAt: now() + cacheTtlMs,
      }
      return catalog
    })()

    try {
      return copyCatalog(await inFlight)
    } finally {
      inFlight = undefined
    }
  }
}

export const getThorchainSecuredAssetCatalog = createThorchainSecuredAssetCatalog()

const thorchainNonSecuredSwapDestinations: readonly KnownCoin[] = Object.entries(thorchainNativeTokensMetadata)
  .filter(([id]) => parseSecuredDenom(id) === null)
  .map(([id, metadata]) => ({
    ...metadata,
    chain: Chain.THORChain,
    id,
    logo: metadata.logo ?? metadata.ticker.toLowerCase(),
  }))

/**
 * Returns the complete THORChain swap-destination universe for picker clients.
 * Secured entries always come from the live catalog (or its explicit offline
 * fallback); THORChain-native/Rujira entries remain sourced from the static
 * token metadata because they are not part of `/thorchain/securedassets`.
 */
export const getThorchainSwapDestinationAssets = async (
  options: {
    forceRefresh?: boolean
    fetchCatalog?: ThorchainSecuredAssetCatalogFetcher
  } = {}
): Promise<ThorchainSwapDestinationAsset[]> => {
  const { fetchCatalog = getThorchainSecuredAssetCatalog, forceRefresh } = options
  const catalog = await fetchCatalog({ forceRefresh })
  return [...thorchainNonSecuredSwapDestinations.map(asset => ({ ...asset })), ...catalog.assets]
}

export const getThorchainSecuredAssetL1Asset = (coin: { chain: Chain; id?: string }): string | null => {
  if (coin.chain !== Chain.THORChain || !coin.id) return null
  return parseSecuredDenom(coin.id)?.l1Asset ?? null
}
