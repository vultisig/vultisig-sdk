import { Chain } from '@vultisig/core-chain/Chain'
import { getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import { SwapKitEnabledChain, SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { attempt } from '@vultisig/lib-utils/attempt'

/**
 * Providers handled by the dedicated native THORChain/MayaChain path, never via
 * SwapKit aggregation. Filtered out of both route selection and the pair-support
 * cross-check so a native-only provider can't make a pair look SwapKit-routable.
 */
export const swapKitExcludedProviders = new Set([
  'THORCHAIN',
  'THORCHAIN_STREAMING',
  'MAYACHAIN',
  'MAYACHAIN_STREAMING',
])

export const normalizeSwapKitProvider = (provider: string): string =>
  provider.trim().toUpperCase().replace(/[-\s]/g, '_')

/**
 * Chain → SwapKit `enabledChainIds` token as returned by `/providers`. EVM chains
 * use their numeric EVM chain id; non-EVM chains use SwapKit's named id. This is a
 * DISTINCT id-space from `swapKitChainId` (the asset-prefix used in `/v3/quote`).
 */
const swapKitProviderChainId: Record<SwapKitEnabledChain, string> = {
  [Chain.Ethereum]: '1',
  [Chain.Arbitrum]: '42161',
  [Chain.Avalanche]: '43114',
  [Chain.Base]: '8453',
  [Chain.BSC]: '56',
  [Chain.Optimism]: '10',
  [Chain.Polygon]: '137',
  [Chain.Solana]: 'solana',
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoincash',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Ripple]: 'ripple',
  [Chain.Ton]: 'ton',
  [Chain.Tron]: '728126428',
  [Chain.Zcash]: 'zcash',
  [Chain.Cardano]: 'cardano',
  [Chain.Cosmos]: 'cosmos',
  [Chain.Dash]: 'dash',
  [Chain.Kujira]: 'kaiyo-1',
  [Chain.MayaChain]: 'mayachain-mainnet-v1',
  [Chain.Sui]: 'sui',
  [Chain.THORChain]: 'thorchain-1',
}

export type SwapKitProviderInfo = {
  provider: string
  enabledChainIds: string[]
}

type ProvidersCache = {
  baseUrl: string
  providers: SwapKitProviderInfo[]
  fetchedAt: number
}

const PROVIDERS_CACHE_TTL_MS = 10 * 60 * 1000

// Short timeout so a stalled /providers call fails open fast instead of dragging
// out the no-route classification path (the outer findSwapQuote per-fetcher
// timeout would also catch it, but much later).
const PROVIDERS_FETCH_TIMEOUT_MS = 5_000

let providersCache: ProvidersCache | null = null

/** Test-only: clear the in-memory `/providers` snapshot. */
export const resetSwapKitProvidersCache = () => {
  providersCache = null
}

const parseProviders = (data: unknown): SwapKitProviderInfo[] => {
  const list = Array.isArray(data) ? data : []

  return list.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const { provider, enabledChainIds } = entry as Record<string, unknown>
    if (typeof provider !== 'string' || !Array.isArray(enabledChainIds)) {
      return []
    }

    return [
      {
        provider,
        enabledChainIds: enabledChainIds.filter((id): id is string => typeof id === 'string'),
      },
    ]
  })
}

/**
 * Fetches and caches SwapKit's `/providers` snapshot. The snapshot rarely changes
 * and is only needed on the unhappy path, so a coarse TTL is enough. On any
 * failure returns an empty list, which callers treat as "unknown" (fail-open).
 */
export const getSwapKitProviders = async (): Promise<SwapKitProviderInfo[]> => {
  const { apiKey, baseUrl } = getSwapKitConfig()

  if (
    providersCache &&
    providersCache.baseUrl === baseUrl &&
    Date.now() - providersCache.fetchedAt < PROVIDERS_CACHE_TTL_MS
  ) {
    return providersCache.providers
  }

  const trimmedApiKey = apiKey?.trim()
  const result = await attempt(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROVIDERS_FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/providers`, {
        headers: trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {},
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`SwapKit providers request failed (${response.status})`)
      }

      return parseProviders(await response.json())
    } finally {
      clearTimeout(timeoutId)
    }
  })

  if ('error' in result) {
    return []
  }

  providersCache = { baseUrl, providers: result.data, fetchedAt: Date.now() }
  return result.data
}

/**
 * SwapKit collapses "amount below provider minimum" and "pair not supported" into
 * the same `noRoutesFound` 404, so the envelope alone can't disambiguate them.
 * Cross-check the cached `/providers` snapshot: if a single non-excluded provider
 * enables BOTH chains, the pair is structurally supported, so a no-route result
 * must be amount-related. Mirrors vultisig-ios #4418.
 *
 * Intersection on a SINGLE provider (not a union across providers): a provider
 * that enables both chains is far likelier to actually route between them than
 * two providers each covering one side. Fails open (returns `true`) when the
 * snapshot is unavailable — degrading to "amount too small" beats a misleading
 * "no route" message.
 */
export const isSwapKitPairSupported = async ({
  from,
  to,
}: {
  from: SwapKitSourceChain
  to: SwapKitEnabledChain
}): Promise<boolean> => {
  const providers = await getSwapKitProviders()
  if (providers.length === 0) {
    return true
  }

  const fromId = swapKitProviderChainId[from]
  const toId = swapKitProviderChainId[to]

  return providers.some(
    ({ provider, enabledChainIds }) =>
      !swapKitExcludedProviders.has(normalizeSwapKitProvider(provider)) &&
      enabledChainIds.includes(fromId) &&
      enabledChainIds.includes(toId)
  )
}
