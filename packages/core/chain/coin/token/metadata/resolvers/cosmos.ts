import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosWasmTokenInfoUrl, isCosmosWasmTokenId } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { getCosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { CoinMetadata } from '@vultisig/core-chain/coin/Coin'
import { knownCosmosTokens } from '@vultisig/core-chain/coin/knownTokens/cosmos'
import { TokenMetadataResolver } from '@vultisig/core-chain/coin/token/metadata/resolver'
import { getLastItem } from '@vultisig/lib-utils/array/getLastItem'
import { attempt } from '@vultisig/lib-utils/attempt'
import { asyncFallbackChain } from '@vultisig/lib-utils/promise/asyncFallbackChain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type DenomUnits = { denom: string; exponent: number }
type DenomMetadata = {
  base?: string
  symbol?: string
  display?: string
  denom_units?: DenomUnits[]
}
type IbcDenomTrace = {
  path?: string
  base_denom?: string
}
type Cw20TokenInfo = {
  name?: string
  symbol?: string
  decimals?: number
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry<T> = {
  expiresAt: number
  value: Promise<T | null>
}

const denomMetadataCache = new Map<string, CacheEntry<DenomMetadata>>()
const ibcDenomTraceCache = new Map<string, CacheEntry<IbcDenomTrace>>()

const getCachedOptional = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  load: () => Promise<T | null>
): Promise<T | null> => {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const value = load()
    .then(result => {
      if (result === null) {
        cache.delete(key)
      }

      return result
    })
    .catch(error => {
      cache.delete(key)
      throw error
    })
  cache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    value,
  })

  return value
}

export const clearCosmosTokenMetadataCacheForTests = () => {
  denomMetadataCache.clear()
  ibcDenomTraceCache.clear()
}

const decimalsFromMeta = (meta: DenomMetadata): number | null => {
  if (!meta.denom_units || !meta.display) return null
  const byDisplay = meta.denom_units.find(u => u.denom === meta.display)
  if (byDisplay) return byDisplay.exponent
  if (meta.symbol) {
    const bySymbol = meta.denom_units.find(u => u.denom === meta.symbol)
    if (bySymbol) return bySymbol.exponent
  }
  return null
}

const deriveTicker = (denom: string, meta: DenomMetadata): string => {
  if (meta.symbol) return meta.symbol
  if (meta.display) return meta.display

  if (denom.startsWith('x/staking-')) {
    const base = denom.replace('x/staking-', '')
    return `S${base}`
  }
  if (denom.startsWith('x/')) {
    return getLastItem(denom.split('/'))
  }
  if (denom.startsWith('factory/')) {
    const sub = getLastItem(denom.split('/'))
    return sub.replace(/^u/, '')
  }
  return denom
}

const getMetaResult = (denom: string, meta: DenomMetadata): CoinMetadata => {
  const decimals = decimalsFromMeta(meta)
  if (decimals === null) throw new Error(`Could not fetch decimal for ${denom}`)

  return {
    ticker: deriveTicker(denom, meta),
    decimals,
  }
}

const deriveIbcTraceTicker = (baseDenom: string): string => {
  const ticker = deriveTicker(baseDenom, {})
  if (ticker.startsWith('u') && ticker.length > 1) return ticker.slice(1)

  return ticker
}

const fetchDenomMetaFromLCD = async (lcdBase: string, denom: string): Promise<DenomMetadata | null> => {
  return asyncFallbackChain(
    async () => {
      const byDenom = `${lcdBase}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`
      const byDenomRes = await attempt(() => queryUrl<{ metadata?: DenomMetadata }>(byDenom))
      if (byDenomRes.data?.metadata) return byDenomRes.data.metadata
      throw new Error('Could not fetch metadata byDenom')
    },
    async () => {
      const listUrl = `${lcdBase}/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=1000`
      const listRes = await attempt(() => queryUrl<{ metadatas?: DenomMetadata[] }>(listUrl))
      return listRes.data?.metadatas?.find(data => data.base === denom) ?? null
    }
  )
}

const getDenomMetaFromLCD = async (lcdBase: string, denom: string): Promise<DenomMetadata | null> =>
  getCachedOptional(denomMetadataCache, `${lcdBase}:${denom}`, () => fetchDenomMetaFromLCD(lcdBase, denom))

const getIbcDenomTraceFromLCD = async (lcdBase: string, denom: string): Promise<IbcDenomTrace | null> => {
  if (!denom.startsWith('ibc/')) return null

  const hash = denom.replace(/^ibc\//, '')
  return getCachedOptional(ibcDenomTraceCache, `${lcdBase}:${hash}`, async () => {
    const url = `${lcdBase}/ibc/apps/transfer/v1/denom_traces/${encodeURIComponent(hash)}`
    const res = await attempt(() => queryUrl<{ denom_trace?: IbcDenomTrace }>(url))

    return res.data?.denom_trace ?? null
  })
}

const getBankDenomMetadata = async (chain: CosmosChain, id: string): Promise<CoinMetadata> => {
  const lcd = getCosmosRpcUrl(chain)
  const meta = await getDenomMetaFromLCD(lcd, id)
  if (meta) {
    try {
      return getMetaResult(id, meta)
    } catch (error) {
      if (!id.startsWith('ibc/')) throw error
    }
  }

  const trace = await getIbcDenomTraceFromLCD(lcd, id)
  if (trace?.base_denom) {
    const traceMeta = await getDenomMetaFromLCD(lcd, trace.base_denom)
    if (traceMeta) {
      try {
        return getMetaResult(trace.base_denom, traceMeta)
      } catch {
        // Fall through to hidden trace fallback when trace metadata is incomplete.
      }
    }

    return {
      ticker: deriveIbcTraceTicker(trace.base_denom),
      decimals: chainFeeCoin[chain].decimals,
      isHidden: true,
    }
  }

  throw new Error(`No denom meta information available for ${id}`)
}

const getCw20MetaFromLCD = async (chain: CosmosChain, id: string): Promise<CoinMetadata> => {
  const { data } = await queryUrl<{ data?: Cw20TokenInfo }>(getCosmosWasmTokenInfoUrl({ chain, id }))
  const ticker = data?.symbol?.trim()
  if (!ticker) throw new Error(`Could not fetch CW20 symbol for ${id}`)

  const decimals = data?.decimals
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Could not fetch CW20 decimals for ${id}`)
  }

  return {
    ticker,
    decimals,
  }
}

export const getCosmosTokenMetadata: TokenMetadataResolver<CosmosChain> = async ({ chain, id }) => {
  const knownMeta = knownCosmosTokens[chain]?.[id]
  if (knownMeta) {
    return {
      ticker: knownMeta.ticker,
      decimals: knownMeta.decimals,
      logo: knownMeta.logo,
      priceProviderId: knownMeta.priceProviderId,
    }
  }

  if (isCosmosWasmTokenId(id)) {
    return asyncFallbackChain(
      async () => getCw20MetaFromLCD(chain, id),
      async () => getBankDenomMetadata(chain, id)
    )
  }

  return getBankDenomMetadata(chain, id)
}
