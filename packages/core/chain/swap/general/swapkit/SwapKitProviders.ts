import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getEvmNumericChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
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

export type SwapKitQuoteProvider =
  | 'CAMELOT_V3'
  | 'CHAINFLIP'
  | 'CHAINFLIP_STREAMING'
  | 'FLASHNET'
  | 'GARDEN'
  | 'HARBOR'
  | 'JUPITER'
  | 'NEAR'
  | 'OKX'
  | 'ONEINCH'
  | 'OPENOCEAN_V2'
  | 'PANCAKESWAP'
  | 'PANGOLIN_V1'
  | 'SUSHISWAP_V2'
  | 'TRADERJOE_V2'
  | 'UNISWAP_V2'
  | 'UNISWAP_V3'

export const swapKitAllowedProviders: readonly SwapKitQuoteProvider[] = [
  'CHAINFLIP',
  'CHAINFLIP_STREAMING',
  'NEAR',
  'GARDEN',
  'FLASHNET',
  'HARBOR',
  'ONEINCH',
  'UNISWAP_V2',
  'UNISWAP_V3',
  'JUPITER',
  'OKX',
  'PANCAKESWAP',
  'SUSHISWAP_V2',
  'TRADERJOE_V2',
  'PANGOLIN_V1',
  'CAMELOT_V3',
  'OPENOCEAN_V2',
]

const swapKitAllowedProviderNames = new Set<string>(swapKitAllowedProviders)

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
  [Chain.Hyperliquid]: '999',
  [Chain.Robinhood]: '4663',
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

const swapKitAssetPrefix: Record<SwapKitEnabledChain, string> = {
  [Chain.Arbitrum]: 'ARB',
  [Chain.Avalanche]: 'AVAX',
  [Chain.Base]: 'BASE',
  [Chain.Bitcoin]: 'BTC',
  [Chain.BitcoinCash]: 'BCH',
  [Chain.BSC]: 'BSC',
  [Chain.Cardano]: 'ADA',
  [Chain.Cosmos]: 'GAIA',
  [Chain.Dash]: 'DASH',
  [Chain.Dogecoin]: 'DOGE',
  [Chain.Ethereum]: 'ETH',
  [Chain.Hyperliquid]: 'HYPEREVM',
  [Chain.Kujira]: 'KUJI',
  [Chain.Litecoin]: 'LTC',
  [Chain.MayaChain]: 'MAYA',
  [Chain.Optimism]: 'OP',
  [Chain.Polygon]: 'POL',
  [Chain.Ripple]: 'XRP',
  [Chain.Robinhood]: 'HOOD',
  [Chain.Solana]: 'SOL',
  [Chain.Sui]: 'SUI',
  [Chain.THORChain]: 'THOR',
  [Chain.Ton]: 'TON',
  [Chain.Tron]: 'TRON',
  [Chain.Zcash]: 'ZEC',
}

export type SwapKitChainMetadata = {
  assetPrefix: string
  providerChainId: string
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

type SwapKitTokenInfo = {
  chain: string
  chainId: string
}

type TokensCache = {
  baseUrl: string
  provider: string
  tokens: SwapKitTokenInfo[]
  fetchedAt: number
}

const PROVIDERS_CACHE_TTL_MS = 10 * 60 * 1000

// Short timeout so a stalled /providers call fails open fast instead of dragging
// out the no-route classification path (the outer findSwapQuote per-fetcher
// timeout would also catch it, but much later).
const PROVIDERS_FETCH_TIMEOUT_MS = 5_000

let providersCache: ProvidersCache | null = null
const tokensCache = new Map<string, TokensCache>()

/** Test-only: clear the in-memory `/providers` snapshot. */
export const resetSwapKitProvidersCache = () => {
  providersCache = null
  tokensCache.clear()
}

const parseProviders = (data: unknown): SwapKitProviderInfo[] => {
  const list = Array.isArray(data) ? data : []

  return list.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const { provider, enabledChainIds, supportedChainIds } = entry as Record<string, unknown>
    const chainIds = Array.isArray(enabledChainIds) ? enabledChainIds : supportedChainIds
    if (typeof provider !== 'string' || !Array.isArray(chainIds)) {
      return []
    }

    return [
      {
        provider,
        enabledChainIds: chainIds.flatMap(id => (typeof id === 'string' || typeof id === 'number' ? [String(id)] : [])),
      },
    ]
  })
}

const parseTokens = (data: unknown): SwapKitTokenInfo[] => {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as Record<string, unknown>).tokens)) {
    return []
  }

  return (data as { tokens: unknown[] }).tokens.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const { chain, chainId } = entry as Record<string, unknown>
    if (typeof chain !== 'string' || (typeof chainId !== 'string' && typeof chainId !== 'number')) {
      return []
    }

    return [{ chain, chainId: String(chainId) }]
  })
}

const getSwapKitTokens = async (provider: string): Promise<SwapKitTokenInfo[] | null> => {
  const { apiKey, baseUrl } = getSwapKitConfig()
  const cacheKey = `${baseUrl}\u0000${provider}`
  const cached = tokensCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < PROVIDERS_CACHE_TTL_MS) {
    return cached.tokens
  }

  const trimmedApiKey = apiKey?.trim()
  const result = await attempt(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROVIDERS_FETCH_TIMEOUT_MS)

    try {
      const url = `${baseUrl.replace(/\/$/, '')}/tokens?provider=${encodeURIComponent(provider)}`
      const response = await fetch(url, {
        headers: trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {},
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`SwapKit tokens request failed (${response.status})`)
      }

      return parseTokens(await response.json())
    } finally {
      clearTimeout(timeoutId)
    }
  })

  if ('error' in result) {
    return null
  }

  tokensCache.set(cacheKey, {
    baseUrl,
    provider,
    tokens: result.data,
    fetchedAt: Date.now(),
  })
  return result.data
}

const getSwapKitProviderChainId = (chain: Chain): string | undefined => {
  const configured = (swapKitProviderChainId as Partial<Record<Chain, string>>)[chain]
  if (configured) {
    return configured
  }

  return isChainOfKind(chain, 'evm') ? String(getEvmNumericChainId(chain as EvmChain)) : undefined
}

/**
 * Resolve the two distinct identifiers SwapKit needs for a chain. Shipping
 * legacy chains retain their stable prefix, while newly opened EVM corridors
 * must be present in the current provider catalog and agree on one asset
 * prefix across every quote provider that advertises the canonical EIP-155 id.
 * Missing, partially unavailable, or ambiguous catalog data fails closed for
 * SwapKit only.
 */
export const resolveSwapKitChainMetadata = async (chain: Chain): Promise<SwapKitChainMetadata | undefined> => {
  const providerChainId = getSwapKitProviderChainId(chain)
  if (!providerChainId) {
    return undefined
  }

  const knownPrefix = (swapKitAssetPrefix as Partial<Record<Chain, string>>)[chain]
  if (knownPrefix) {
    return { assetPrefix: knownPrefix, providerChainId }
  }

  const providers = (await getSwapKitProviders()).filter(
    ({ provider, enabledChainIds }) =>
      swapKitAllowedProviderNames.has(normalizeSwapKitProvider(provider)) && enabledChainIds.includes(providerChainId)
  )
  if (providers.length === 0) {
    return undefined
  }

  const tokenLists = await Promise.all(providers.map(({ provider }) => getSwapKitTokens(provider)))
  if (tokenLists.some(tokens => tokens === null)) {
    return undefined
  }

  const providerPrefixes = tokenLists.map(
    tokens =>
      new Set(
        (tokens ?? []).filter(token => token.chainId === providerChainId).map(token => token.chain.trim().toUpperCase())
      )
  )
  if (providerPrefixes.some(prefixes => prefixes.size !== 1)) {
    return undefined
  }

  const prefixes = new Set(providerPrefixes.flatMap(prefixes => [...prefixes]))
  if (prefixes.size !== 1) {
    return undefined
  }

  const [assetPrefix] = prefixes
  if (!assetPrefix || (knownPrefix && assetPrefix !== knownPrefix)) {
    return undefined
  }

  return { assetPrefix, providerChainId }
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
 * Cross-check the cached `/providers` snapshot: if a single quote-allowlisted provider
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
  to: Chain
}): Promise<boolean> => {
  const providers = await getSwapKitProviders()
  if (providers.length === 0) {
    return true
  }

  const fromId = getSwapKitProviderChainId(from)
  const toId = getSwapKitProviderChainId(to)
  if (!fromId || !toId) {
    return false
  }

  return providers.some(
    ({ provider, enabledChainIds }) =>
      swapKitAllowedProviderNames.has(normalizeSwapKitProvider(provider)) &&
      enabledChainIds.includes(fromId) &&
      enabledChainIds.includes(toId)
  )
}
