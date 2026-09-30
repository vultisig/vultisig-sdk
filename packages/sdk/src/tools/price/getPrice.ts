import { Address } from '@ton/core'
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { areEqualTonAddresses } from '@vultisig/core-chain/chains/ton/address'
import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { coinGeckoPlatformForChain } from '../coingecko/platforms'
import { isKnownNativePriceSymbol, NATIVE_COINGECKO_IDS, symbolFromCoinGeckoId } from './coinGeckoIds'

/**
 * Token USD pricing primitive (CoinGecko via the Vultisig proxy).
 *
 * Ported from mcp-ts `price-oracle.ts` (`fetchPriceQuote`) as part of the
 * mcp-ts/backend → SDK code-as-action consolidation. PURE CRYPTO: resolves a
 * USD price for a token from one of four read-only routes (CoinGecko coin ID,
 * EVM/TON contract, Solana mint, or native ticker). It never throws a fake price —
 * a lookup failure surfaces as a thrown error so callers never build a tx off
 * a guessed amount.
 *
 * Agent-layer concerns (token-selection ambiguity prompts, Terra-Classic
 * fiat-denom graceful errors, `_classic` suffix sanitisation) intentionally
 * stay in orchestration and are NOT part of this primitive.
 */

const coinGeckoApiUrl = `${rootApiUrl}/coingeicko/api/v3`

const evmAddressRE = /^0x[0-9a-fA-F]{40}$/
const solanaAddressRE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const evmChains = new Set<string>(Object.values(EvmChain))

const isTonContractAddress = (address: string): boolean => {
  // Address.parseRaw uses parseInt and ignores extra colon-separated fields.
  // Check the complete raw spelling before delegating checksum/account parsing.
  if (address.includes(':') && !/^-?\d+:[0-9a-fA-F]{64}$/.test(address)) return false
  try {
    return Number.isSafeInteger(Address.parse(address).workChain)
  } catch {
    return false
  }
}

/** Parameters describing the token to price. Provide at least one identity. */
export type PriceQuery = {
  /** Ticker (ETH, USDC) — used when no contract is provided. */
  symbol?: string
  /** CoinGecko coin ID for resolved global-coin pricing. */
  coingeckoId?: string
  /** EVM contract / Solana mint / other address-based token id. */
  tokenContract?: string
  /** Source chain, required when looking up by contract/mint. */
  chain?: string
  /** Optional resolved display name from token search. */
  name?: string
}

/** A resolved USD price quote. */
export type PriceQuote = {
  /** USD price per whole token. */
  usd: number
  /** 24h percentage change (0 when CoinGecko omits it). */
  usd24hChange: number
  /** USD market cap (0 when CoinGecko omits it). */
  usdMarketCap: number
  /** Symbol the quote resolved to (uppercased). */
  resolvedSymbol: string
  /** Display name the quote resolved to. */
  resolvedName: string
  /** CoinGecko coin ID, when known. */
  coingeckoId?: string
  /** Chain the contract lives on, for contract/mint lookups. */
  chain?: string
  /** Contract / mint address, for contract/mint lookups. */
  contractAddress?: string
}

type CoinGeckoSimplePrice = {
  usd: number
  usd_24h_change?: number
  usd_market_cap?: number
}

type ContractMetadata = {
  id?: string
  symbol?: string
  name?: string
}

/**
 * Pull the price entry for the contract we actually asked for.
 *
 * CoinGecko's `/simple/token_price/<platform>?contract_addresses=<addr>` keys
 * the response by the contract address. We send exactly one address, so the
 * happy path is a single matching key — but we never blindly take
 * `Object.values(data)[0]`: a proxy/upstream quirk that returns a DIFFERENT
 * contract's entry (or merges an unrelated address in) would otherwise hand the
 * caller a wrong-token price under a correct-looking symbol/contract label.
 * EVM response keys ignore checksum casing. TON addresses compare by account
 * identity; Solana mint identifiers compare exactly because base58 is case-sensitive.
 */
const priceForRequestedContract = (
  data: Record<string, CoinGeckoSimplePrice>,
  requestedContract: string,
  chain: string
): CoinGeckoSimplePrice | undefined => {
  for (const [key, value] of Object.entries(data)) {
    if (
      chain === Chain.Ton
        ? isTonContractAddress(key) && areEqualTonAddresses(key, requestedContract)
        : evmChains.has(chain)
          ? key.toLowerCase() === requestedContract.toLowerCase()
          : key === requestedContract
    ) {
      return value
    }
  }
  return undefined
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const result = await queryUrl<T>(url)
  if (result === undefined || result === null || typeof result === 'string') {
    throw new Error(`unexpected non-JSON response from ${url}`)
  }
  return result as T
}

const fetchContractMetadata = async (
  platform: string,
  contractAddress: string
): Promise<ContractMetadata | undefined> =>
  fetchJson<ContractMetadata>(`${coinGeckoApiUrl}/coins/${platform}/contract/${contractAddress}`).catch(() => undefined)

/**
 * Resolve a USD price quote for a single token.
 *
 * Resolution routes, in order:
 *  0. `coingeckoId` (no contract) → `/simple/price?ids=`
 *  1. EVM contract + chain        → `/simple/token_price/<platform>`
 *  2. Solana mint / TON jetton    → `/simple/token_price/<platform>`
 *  3. Native ticker (symbol)      → coin-ID map → `/simple/price?ids=`
 *
 * Throws on lookup failure — never returns a fabricated price.
 *
 * @example
 * ```ts
 * const eth = await getPrice({ symbol: 'ETH' })
 * console.log(eth.usd) // => 3421.55
 * ```
 */
export const getPrice = async (query: PriceQuery): Promise<PriceQuote> => {
  const { symbol, coingeckoId, tokenContract, chain, name } = query

  // Route 0: explicit CoinGecko coin ID (no contract).
  if (coingeckoId && !tokenContract) {
    const data = await fetchJson<Record<string, CoinGeckoSimplePrice>>(
      `${coinGeckoApiUrl}/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    )
    const priceData = data[coingeckoId]
    if (!priceData || typeof priceData.usd !== 'number') {
      throw new Error(`price lookup failed for "${coingeckoId}"`)
    }
    return {
      usd: priceData.usd,
      usd24hChange: priceData.usd_24h_change ?? 0,
      usdMarketCap: priceData.usd_market_cap ?? 0,
      resolvedSymbol: symbol?.toUpperCase() ?? coingeckoId.toUpperCase(),
      resolvedName: name ?? coingeckoId,
      coingeckoId,
    }
  }

  // Validate TON explicitly before any address-shape or native ticker route.
  if (tokenContract && chain === Chain.Ton && !isTonContractAddress(tokenContract)) {
    throw new Error(`invalid TON token contract address "${tokenContract}"`)
  }

  // Route 1: EVM contract + chain.
  if (tokenContract && evmAddressRE.test(tokenContract)) {
    if (!chain) {
      throw new Error('chain is required when looking up a token by contract address')
    }
    const platform = evmChains.has(chain) ? coinGeckoPlatformForChain(chain) : undefined
    if (!platform) {
      throw new Error(`unsupported chain "${chain}" for token price lookup`)
    }
    const data = await fetchJson<Record<string, CoinGeckoSimplePrice>>(
      `${coinGeckoApiUrl}/simple/token_price/${platform}?contract_addresses=${tokenContract.toLowerCase()}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    )
    const priceData = priceForRequestedContract(data, tokenContract, chain)
    if (!priceData || typeof priceData.usd !== 'number') {
      throw new Error(`token price lookup failed for ${tokenContract}`)
    }
    const metadata =
      symbol && name && coingeckoId ? undefined : await fetchContractMetadata(platform, tokenContract.toLowerCase())
    return {
      usd: priceData.usd,
      usd24hChange: priceData.usd_24h_change ?? 0,
      usdMarketCap: priceData.usd_market_cap ?? 0,
      resolvedSymbol: symbol ?? metadata?.symbol?.toUpperCase() ?? `${tokenContract.slice(0, 8)}...`,
      resolvedName: name ?? metadata?.name ?? `Token on ${chain}`,
      coingeckoId: coingeckoId ?? metadata?.id,
      chain,
      contractAddress: tokenContract,
    }
  }

  // Route 2: validated Solana mint or TON jetton master.
  if (tokenContract && ((chain === Chain.Solana && solanaAddressRE.test(tokenContract)) || chain === Chain.Ton)) {
    const platform = coinGeckoPlatformForChain(chain)
    if (!platform) {
      throw new Error(`unsupported chain "${chain}" for token price lookup`)
    }
    const encodedContract = encodeURIComponent(tokenContract)
    const data = await fetchJson<Record<string, CoinGeckoSimplePrice>>(
      `${coinGeckoApiUrl}/simple/token_price/${platform}?contract_addresses=${encodedContract}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    )
    const priceData = priceForRequestedContract(data, tokenContract, chain)
    if (!priceData || typeof priceData.usd !== 'number') {
      throw new Error(`${chain === Chain.Solana ? 'solana' : 'TON'} token price lookup failed for ${tokenContract}`)
    }
    const metadata = symbol && name && coingeckoId ? undefined : await fetchContractMetadata(platform, encodedContract)
    return {
      usd: priceData.usd,
      usd24hChange: priceData.usd_24h_change ?? 0,
      usdMarketCap: priceData.usd_market_cap ?? 0,
      resolvedSymbol: symbol ?? metadata?.symbol?.toUpperCase() ?? `${tokenContract.slice(0, 8)}...`,
      resolvedName: name ?? metadata?.name ?? `Token on ${chain}`,
      coingeckoId: coingeckoId ?? metadata?.id,
      chain,
      contractAddress: tokenContract,
    }
  }

  // Route 3: native ticker via the CoinGecko ID map.
  if (symbol) {
    const upper = symbol.toUpperCase()
    const cgId = NATIVE_COINGECKO_IDS[upper]
    if (cgId) {
      const data = await fetchJson<Record<string, CoinGeckoSimplePrice>>(
        `${coinGeckoApiUrl}/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
      )
      const priceData = data[cgId]
      if (!priceData || typeof priceData.usd !== 'number') {
        throw new Error(`price lookup failed for ${upper}`)
      }
      return {
        usd: priceData.usd,
        usd24hChange: priceData.usd_24h_change ?? 0,
        usdMarketCap: priceData.usd_market_cap ?? 0,
        resolvedSymbol: upper,
        resolvedName: cgId,
        coingeckoId: cgId,
      }
    }

    throw new Error(`price lookup for "${symbol}" requires a resolved CoinGecko id or contract address`)
  }

  throw new Error('getPrice: must provide either symbol, coingeckoId, or tokenContract')
}

/**
 * Resolve USD price quotes for multiple tokens in parallel.
 *
 * Each query is resolved independently via {@link getPrice}; a failing query
 * does NOT reject the batch — it is reported as `{ ok: false, error }` so a
 * single unpriceable token can't sink the whole request. Order of results
 * mirrors the input order.
 *
 * @example
 * ```ts
 * const [eth, btc, usdc] = await getPricesBatch([
 *   { symbol: 'ETH' },
 *   { symbol: 'BTC' },
 *   { symbol: 'USDC' },
 * ])
 * if (eth.ok) console.log(eth.quote.usd)
 * ```
 */
export type PriceBatchResult =
  | { ok: true; query: PriceQuery; quote: PriceQuote }
  | { ok: false; query: PriceQuery; error: string }

export const getPricesBatch = async (queries: PriceQuery[]): Promise<PriceBatchResult[]> =>
  Promise.all(
    queries.map(async (query): Promise<PriceBatchResult> => {
      try {
        const quote = await getPrice(query)
        return { ok: true, query, quote }
      } catch (error) {
        return { ok: false, query, error: error instanceof Error ? error.message : String(error) }
      }
    })
  )

export { isKnownNativePriceSymbol, symbolFromCoinGeckoId }
