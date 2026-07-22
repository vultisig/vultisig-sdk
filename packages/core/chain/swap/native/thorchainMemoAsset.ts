import { toEntries } from '@vultisig/lib-utils/record/toEntries'

import { Chain } from '../../Chain'
import { thorchainLpChainCode } from '../../chains/cosmos/thor/thorchainLp'
import { Coin } from '../../coin/Coin'
import { nativeSwapChainIds, thorChainSwapEnabledChains } from './NativeSwapChain'

/**
 * Number of trailing contract-address characters a THORChain memo uses to
 * disambiguate a token from others sharing its ticker (`ETH.USDC-06EB48`).
 *
 * Deliberately NOT the full contract address: memo bytes are scarce (UTXO
 * sources cap at 80), and THORChain resolves the abbreviated form against its
 * pool list. This is why this module exists separately from
 * `getThorchainLpPool`, which uses the *full* uppercased id — pool ids and memo
 * assets are different encodings and must not be unified.
 */
const contractSuffixLength = 6

/**
 * THORChain memo-asset chain prefix (`BTC`, `ETH`, `THOR`, …) for every chain
 * routable through THORChain.
 *
 * Limit swaps (`=<`) share THORChain's regular-swap chain universe — `=` vs `=<`
 * only selects execution behavior (price/queue/TTL), not a different set of
 * chains, per THORChain's memo docs (dev.thorchain.org/concepts/memos.html).
 *
 * `thorchainLpChainCode` alone under-resolves this: it's LP-scoped (keyed off
 * pool existence), so Solana/Noble — which have no THORChain LP pools but ARE
 * valid swap destinations — have no entry. We union the two rather than
 * replacing it outright: `thorChainSwapEnabledChains` is itself missing chains
 * (Dash/Kujira/Arbitrum/Zcash) that the LP map already resolves correctly, so a
 * straight swap of authority would regress those. We deliberately do NOT use the
 * broader `nativeSwapChainIds`, which also carries MayaChain-only entries (e.g.
 * Cardano, MayaChain itself) that aren't valid THORChain destinations.
 */
export const thorchainMemoAssetChainPrefix: Readonly<Partial<Record<Chain, string>>> = Object.freeze({
  ...thorchainLpChainCode,
  ...thorChainSwapEnabledChains.reduce<Partial<Record<Chain, string>>>((acc, chain) => {
    acc[chain] = nativeSwapChainIds[chain]
    return acc
  }, {}),
})

/**
 * Reverse of {@link thorchainMemoAssetChainPrefix}: THORChain asset prefix →
 * `Chain`.
 *
 * Derived by inversion rather than hand-maintained so the two directions cannot
 * drift. Drift here is a fund-safety bug: the memo *is* the order, so a prefix
 * one direction accepts and the other rejects either blocks a valid order or
 * builds one that routes somewhere unintended.
 */
export const thorchainAssetPrefixToChain: Readonly<Partial<Record<string, Chain>>> = Object.freeze(
  toEntries(thorchainMemoAssetChainPrefix).reduce<Partial<Record<string, Chain>>>((acc, { key, value }) => {
    acc[value] = key
    return acc
  }, {})
)

/**
 * Whether a chain can be encoded as a THORChain memo asset — i.e. whether it is
 * routable through THORChain at all.
 *
 * Use this to filter coin pickers so a user cannot select a chain that would
 * only fail later, at memo-build time.
 */
export const isThorchainRoutable = (chain: Chain): boolean => thorchainMemoAssetChainPrefix[chain] !== undefined

/**
 * Whether a THORChain-held token id denotes a *secured* asset — an L1 asset
 * custodied on THORChain, whose denom encodes its origin chain (`eth-usdc-0x…`,
 * `xrp-xrp`).
 *
 * Mirrors iOS `THORChainHelper.isSecuredAsset`: RUNE and `x/…` THORChain-native
 * synths are not secured assets.
 */
export const isThorchainSecuredAssetId = (id: string): boolean => !id.startsWith('x/') && id.includes('-')

export type ThorchainMemoAssetInput = Pick<Coin, 'chain' | 'id' | 'ticker'>

/**
 * Build the THORChain memo-asset string for a coin — the `source_asset` /
 * `target_asset` a limit-swap memo is built from.
 *
 * - native → `CHAIN.TICKER` (`BTC.BTC`, `THOR.RUNE`)
 * - THORChain secured asset → its denom verbatim (`eth-usdc-0x…`), since that is
 *   what identifies the pool; encoding one as a normal token targets the wrong one
 * - other THORChain tokens → `THOR.TICKER` (`THOR.TCY`, `THOR.RUJI`)
 * - any other token → `CHAIN.TICKER-<last 6 of id, uppercased>` (`ETH.USDC-06EB48`)
 *
 * Throws for chains THORChain cannot route, empty tickers, and ids too short to
 * form a suffix — a malformed asset segment must fail here rather than at
 * broadcast time, once funds are committed.
 */
export const getThorchainMemoAsset = ({ chain, id, ticker }: ThorchainMemoAssetInput): string => {
  const prefix = thorchainMemoAssetChainPrefix[chain]
  if (!prefix) {
    throw new Error(`getThorchainMemoAsset: ${chain} is not routable through THORChain`)
  }

  const normalizedTicker = ticker.trim()
  if (!normalizedTicker) {
    throw new Error(`getThorchainMemoAsset: ticker must be a non-empty string for ${chain}`)
  }

  const normalizedId = id?.trim() ?? ''
  if (!normalizedId) {
    return `${prefix}.${normalizedTicker}`
  }

  if (chain === Chain.THORChain) {
    return isThorchainSecuredAssetId(normalizedId) ? normalizedId : `${prefix}.${normalizedTicker}`
  }

  if (normalizedId.length < contractSuffixLength) {
    throw new Error(
      `getThorchainMemoAsset: ${chain} token id ${JSON.stringify(normalizedId)} is shorter than ${contractSuffixLength} characters`
    )
  }

  return `${prefix}.${normalizedTicker}-${normalizedId.slice(-contractSuffixLength).toUpperCase()}`
}
