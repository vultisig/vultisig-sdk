import { Chain } from '@vultisig/core-chain/Chain'
import { tonAddressToRawKey } from '@vultisig/core-chain/chains/ton/address'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { attempt } from '@vultisig/lib-utils/attempt'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { convertDuration } from '@vultisig/lib-utils/time/convertDuration'

import { normalizeJettonSymbol } from './symbol'

/**
 * Tonkeeper's community-reviewed jetton whitelist, the list every major TON
 * wallet uses as its "verified" tier. Compiled from the repo's YAML sources on
 * every merge; served with `Access-Control-Allow-Origin: *`.
 */
export const tonAssetsJettonsUrl = 'https://raw.githubusercontent.com/tonkeeper/ton-assets/main/jettons.json'

type TonAssetsJetton = {
  address: string
  name?: string
  symbol?: string
  decimals?: number
  image?: string
  coingecko?: string
}

/** A jetton we treat as legitimate, keyed by its lower-cased raw master address. */
export type VerifiedJetton = {
  address: string
  symbol: string
  name?: string
  decimals?: number
  logo?: string
  priceProviderId?: string
}

/**
 * Verified jettons indexed for the two questions verification asks: "is this
 * address listed?" and "does this symbol or name belong to a listed jetton?".
 * `symbols` and `names` hold `normalizeJettonSymbol` skeletons.
 */
export type TonVerifiedJettonRegistry = {
  byAddress: Record<string, VerifiedJetton>
  symbols: Set<string>
  names: Set<string>
}

/**
 * Builds a registry from a list of verified jettons. On an address collision the
 * earlier entry's metadata is kept in `byAddress`, but every entry's symbol and
 * name are indexed: two entries for one address describe the same verified
 * contract, and a counterfeit may copy either spelling. Our curated USDT carries
 * the ticker `USDT` and no name; only the ton-assets duplicate contributes
 * `USD₮` and `Tether USD`, so dropping it would let a "Tether USD" impostor
 * through as merely unverified.
 */
export const makeTonVerifiedJettonRegistry = (jettons: VerifiedJetton[]): TonVerifiedJettonRegistry => {
  const registry: TonVerifiedJettonRegistry = { byAddress: {}, symbols: new Set(), names: new Set() }

  for (const jetton of jettons) {
    const address = tonAddressToRawKey(jetton.address)
    registry.byAddress[address] ??= { ...jetton, address }

    const symbol = normalizeJettonSymbol(jetton.symbol)
    if (symbol) registry.symbols.add(symbol)

    const name = jetton.name ? normalizeJettonSymbol(jetton.name) : ''
    if (name) registry.names.add(name)
  }

  return registry
}

const getCuratedJettons = (): VerifiedJetton[] =>
  knownTokens[Chain.Ton].flatMap(({ id, ticker, decimals, logo, priceProviderId }) =>
    id
      ? [
          {
            address: tonAddressToRawKey(id),
            symbol: ticker,
            decimals,
            logo,
            ...(priceProviderId === undefined ? {} : { priceProviderId }),
          },
        ]
      : []
  )

const isTonAssetsJetton = (value: unknown): value is TonAssetsJetton =>
  typeof value === 'object' && value !== null && typeof (value as { address?: unknown }).address === 'string'

const fetchTonAssetsJettons = async (): Promise<VerifiedJetton[]> => {
  const response = await queryUrl<unknown>(tonAssetsJettonsUrl)
  if (!Array.isArray(response)) {
    throw new Error('ton-assets jettons.json is not a list')
  }

  return response.filter(isTonAssetsJetton).flatMap(({ address, name, symbol, decimals, image, coingecko }) => {
    const ticker = symbol?.trim()
    if (!ticker) return []

    return [
      {
        address: tonAddressToRawKey(address),
        symbol: ticker,
        ...(name ? { name } : {}),
        ...(typeof decimals === 'number' ? { decimals } : {}),
        ...(image ? { logo: image } : {}),
        ...(coingecko ? { priceProviderId: coingecko } : {}),
      },
    ]
  })
}

// Only a successful fetch is cached: a rejected promise is never stored, so an
// outage is retried on the next call instead of pinning the degraded registry.
const getFullRegistry = memoizeAsync(
  async () => makeTonVerifiedJettonRegistry([...getCuratedJettons(), ...(await fetchTonAssetsJettons())]),
  { cacheTime: convertDuration(1, 'h', 'ms') }
)

let curatedRegistry: TonVerifiedJettonRegistry | undefined

const getCuratedRegistry = (): TonVerifiedJettonRegistry => {
  if (!curatedRegistry) {
    curatedRegistry = makeTonVerifiedJettonRegistry(getCuratedJettons())
  }

  return curatedRegistry
}

/**
 * The jettons we consider verified: our own curated TON tokens (which win, so
 * their tickers and price ids are kept) merged with the ton-assets whitelist.
 * Degrades to the curated list alone when the whitelist cannot be fetched, so
 * discovery and labels keep working offline — with fewer jettons recognised.
 */
export const getTonVerifiedJettonRegistry = async (): Promise<TonVerifiedJettonRegistry> => {
  const result = await attempt(getFullRegistry())
  if ('data' in result && result.data) return result.data

  console.warn('[ton] verified jetton list unavailable; using the curated list only', result.error)

  return getCuratedRegistry()
}
