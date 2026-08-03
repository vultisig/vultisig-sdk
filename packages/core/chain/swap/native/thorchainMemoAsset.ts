import { toEntries } from '@vultisig/lib-utils/record/toEntries'

import { Chain } from '../../Chain'
import { thorchainLpChainCode } from '../../chains/cosmos/thor/thorchainLp'
import { Coin } from '../../coin/Coin'
import { toNativeSwapAsset } from './asset/toNativeSwapAsset'
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
 * Every separator a THORChain memo asset can use: L1 (`.`), synth (`/`), trade
 * (`~`) and secured (`-`). Shared so the modules that have to find where a
 * chain prefix ends cannot disagree about which flavours exist.
 */
export const thorchainMemoAssetSeparators: readonly string[] = Object.freeze(['.', '/', '~', '-'])

/**
 * Index of the separator that ends a memo asset's CHAIN prefix, or `-1` when the
 * asset carries none.
 *
 * Always the FIRST separator, never the last. A secured asset spells the whole
 * denom with `-` (`eth-usdc-0x…`), so searching from the right would put the
 * boundary inside the token identifier and make every secured asset read as a
 * different chain, or as truncated. Shared with the traversal rather than only
 * the character list, so the three modules that need this boundary cannot
 * disagree about where it falls.
 */
export const findThorchainMemoAssetSeparatorIndex = (asset: string): number =>
  [...asset].findIndex(char => thorchainMemoAssetSeparators.includes(char))

/**
 * The chain a memo asset ORIGINATES from — what `Asset.GetLayer1Asset().Chain`
 * resolves to on THORNode's side.
 *
 * Reads the prefix up to the first separator, so it holds for every flavour:
 * `ETH.USDC-0x…`, `BTC/BTC` and the secured `eth-usdc-0x…` all resolve to their
 * L1 chain. Splitting on `.` alone would return the whole denom for a secured
 * asset and resolve nothing.
 *
 * Note this is the asset's home chain, NOT necessarily the chain a transaction
 * touching it is signed from — a secured asset lives on THORChain while still
 * reporting Ethereum here.
 *
 * `undefined` for a prefix this SDK cannot route, which a caller should treat as
 * "unknown chain" rather than an error: an asset THORChain understands and this
 * SDK does not is still a real order.
 */
export const getThorchainMemoAssetChain = (asset: string): Chain | undefined => {
  const separatorIndex = findThorchainMemoAssetSeparatorIndex(asset)
  const prefix = separatorIndex === -1 ? asset : asset.slice(0, separatorIndex)

  return thorchainAssetPrefixToChain[prefix.toUpperCase()]
}

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
 * Abbreviate a trailing contract address to its last {@link contractSuffixLength}
 * characters, uppercased. Leaves an asset with no contract segment untouched.
 */
const abbreviateContractSuffix = (asset: string): string => {
  const separatorIndex = asset.indexOf('-')
  if (separatorIndex === -1) {
    return asset
  }

  const contract = asset.slice(separatorIndex + 1)
  if (contract.length < contractSuffixLength) {
    throw new Error(
      `getThorchainMemoAsset: contract segment ${JSON.stringify(contract)} is shorter than ${contractSuffixLength} characters`
    )
  }

  return `${asset.slice(0, separatorIndex)}-${contract.slice(-contractSuffixLength).toUpperCase()}`
}

/**
 * Notation shared by both memo spellings: the routability and ticker checks a
 * memo asset must pass, then the one converter that decides what a THORChain
 * asset string looks like.
 *
 * Both callers reject the same inputs for the same reasons, so an asset that is
 * unbuildable for a placement cannot become buildable for a cancel.
 */
const toValidatedNativeSwapAsset = ({ chain, id, ticker }: ThorchainMemoAssetInput, caller: string): string => {
  if (!isThorchainRoutable(chain)) {
    throw new Error(`${caller}: ${chain} is not routable through THORChain`)
  }

  const normalizedTicker = ticker.trim()
  if (!normalizedTicker) {
    throw new Error(`${caller}: ticker must be a non-empty string for ${chain}`)
  }

  const normalizedId = id?.trim()

  return toNativeSwapAsset({ chain, id: normalizedId || undefined, ticker: normalizedTicker })
}

/**
 * Build the THORChain memo-asset string for a coin — the `source_asset` /
 * `target_asset` a limit-swap memo is built from.
 *
 * - native → `CHAIN.TICKER` (`BTC.BTC`, `THOR.RUNE`)
 * - THORChain tokens → `THOR.TICKER` (`THOR.TCY`, `THOR.RUJI`)
 * - THORChain secured assets → `CHAIN-ASSET` (`XRP-XRP`, `ETH-USDC-0x…`)
 * - any other token → `CHAIN.TICKER-<last 6 of contract, uppercased>` (`ETH.USDC-06EB48`)
 *
 * Notation comes from {@link toNativeSwapAsset}, the converter the market-swap
 * path already uses, so this package has exactly one definition of what a
 * THORChain asset string looks like. The only thing added on top is the contract
 * abbreviation: memo bytes are scarce (UTXO sources cap at 80) and THORChain
 * resolves the shortened form against its pool list, whereas the swap API is
 * given the full address. Secured assets are deliberately left un-abbreviated —
 * the trailing address is part of the denom that identifies them.
 *
 * NOTE: `buildLimitSwapMemo` does not currently accept secured assets — its
 * `assertValidPoolId` check requires dotted `CHAIN.ASSET` notation and rejects
 * the `CHAIN-ASSET` form. That gap predates this helper and is tracked
 * separately; the value returned here is the correct notation for when it lands.
 *
 * Throws for chains THORChain cannot route, empty tickers, and contract segments
 * too short to abbreviate — a malformed asset segment must fail here rather than
 * at broadcast time, once funds are committed.
 */
export const getThorchainMemoAsset = (input: ThorchainMemoAssetInput): string => {
  const asset = toValidatedNativeSwapAsset(input, 'getThorchainMemoAsset')

  // THORChain-held assets (secured denoms, `THOR.TCY`) carry no L1 contract to
  // shorten -- the trailing address of a secured denom identifies the asset.
  return input.chain === Chain.THORChain ? asset : abbreviateContractSuffix(asset)
}

/**
 * Build the THORChain memo-asset string a **cancel** memo must use — the same
 * notation {@link getThorchainMemoAsset} emits, minus the abbreviation.
 *
 * - native → `CHAIN.TICKER` (`BTC.BTC`, `THOR.RUNE`)
 * - THORChain tokens → `THOR.TICKER` (`THOR.TCY`)
 * - THORChain secured assets → `CHAIN-ASSET` (`XRP-XRP`, `ETH-USDC-0x…`)
 * - any other token → `CHAIN.TICKER-<full contract>` (`ETH.USDC-0xA0b8…`)
 *
 * The difference from the placement spelling is the entire point. A placement
 * memo abbreviates an L1 contract to its last six characters because memo bytes
 * are scarce and `fuzzyAssetMatch` expands it again on arrival. A cancel gets no
 * such treatment: `ModifyLimitSwapMemo` is the one inbound memo type
 * `processOneTxIn` does NOT route through `fuzzyAssetMatch`, so its asset string
 * builds the order-index key verbatim. An abbreviation there addresses a bucket
 * that by construction holds no order — the cancel is accepted, costs a fee, and
 * cancels nothing.
 *
 * Both spellings share their notation source and their validation, so the two
 * cannot drift apart in anything except the abbreviation.
 */
export const getThorchainCancelMemoAsset = (input: ThorchainMemoAssetInput): string =>
  toValidatedNativeSwapAsset(input, 'getThorchainCancelMemoAsset')
