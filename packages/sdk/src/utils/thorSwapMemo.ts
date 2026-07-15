import { Chain } from '@vultisig/core-chain/Chain'

import { VaultError, VaultErrorCode } from '../vault/VaultError'

/**
 * THORChain swap-memo chain codes → SDK Chain enum.
 *
 * Used to resolve the destination chain encoded in
 * `=:CHAIN.ASSET:DEST::v0:slippage` memos back to a Chain enum so
 * consumers can dispatch through the SDK without re-declaring the map.
 *
 * Reference: https://docs.thorchain.org/concepts/memos
 * Maya uses similar codes — additions here cover both ecosystems.
 */
const THOR_MEMO_CHAIN_TO_ENUM: Record<string, Chain> = {
  BTC: Chain.Bitcoin,
  ETH: Chain.Ethereum,
  BSC: Chain.BSC,
  AVAX: Chain.Avalanche,
  BASE: Chain.Base,
  ARB: Chain.Arbitrum,
  BCH: Chain.BitcoinCash,
  LTC: Chain.Litecoin,
  DOGE: Chain.Dogecoin,
  GAIA: Chain.Cosmos,
  THOR: Chain.THORChain,
  RUNE: Chain.THORChain,
  XRP: Chain.Ripple,
  DASH: Chain.Dash,
  ZEC: Chain.Zcash,
  MAYA: Chain.MayaChain,
  CACAO: Chain.MayaChain,
}

/**
 * THORChain abbreviated asset shortcuts → expanded `CHAIN.ASSET`.
 *
 * Reference: https://docs.thorchain.org/concepts/asset-notation#asset-shorthand
 */
const THOR_MEMO_ASSET_SHORTCUTS: Record<string, string> = {
  b: 'BTC.BTC',
  e: 'ETH.ETH',
  s: 'BSC.BNB',
  a: 'AVAX.AVAX',
  c: 'BCH.BCH',
  l: 'LTC.LTC',
  d: 'DOGE.DOGE',
  g: 'GAIA.ATOM',
  r: 'THOR.RUNE',
  x: 'XRP.XRP',
  cacao: 'MAYA.CACAO',
  dash: 'DASH.DASH',
  zec: 'ZEC.ZEC',
}

/**
 * Parsed shape of a THORChain / MayaChain swap memo.
 *
 * - `destChainCode` is the raw memo chain prefix (`XRP`, `ETH`, ...).
 * - `destAsset` is the asset ticker only — any ERC-20 contract suffix
 *   (`USDC-0X...`) is stripped because SDK swap callers take the ticker.
 * - `destAddress` is the user-supplied destination on the destination chain.
 *   May be empty when the memo omits it.
 * - `toChain` is the resolved SDK Chain enum destination.
 */
export type ParsedThorSwapMemo = {
  destChainCode: string
  destAsset: string
  destAddress: string
  toChain: Chain
}

/**
 * Parse a THORChain / MayaChain swap memo into its destination-routing components.
 *
 * Accepts the shorthand notation documented at
 * https://docs.thorchain.org/concepts/asset-notation#asset-shorthand
 * (`x` → `XRP.XRP`, `e` → `ETH.ETH`, ...).
 *
 * Throws `VaultError(NotImplemented)` for non-swap memos and
 * `VaultError(InvalidConfig)` for malformed swap memos. Unknown destination
 * chain codes throw `VaultError(UnsupportedChain)`.
 */
export function parseThorSwapMemo(memo: string): ParsedThorSwapMemo {
  if (!memo.startsWith('=:')) {
    throw new VaultError(
      VaultErrorCode.NotImplemented,
      `parseThorSwapMemo: only swap memos (=:CHAIN.ASSET:DEST...) supported on this path; got memo='${memo}'. ` +
        'LP memos (+:/-:) route through signThorMsgDepositLp; loan / validator ops out of scope.'
    )
  }

  const memoBody = memo.slice(2)
  const parts = memoBody.split(':')

  let chainAsset = parts[0]
  if (chainAsset && !chainAsset.includes('.')) {
    const expanded = THOR_MEMO_ASSET_SHORTCUTS[chainAsset.toLowerCase()]
    if (expanded) chainAsset = expanded
  }

  if (!chainAsset || !chainAsset.includes('.')) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `parseThorSwapMemo: malformed swap memo '${memo}': missing CHAIN.ASSET in first segment.`
    )
  }

  const [destChainCode, destAssetRaw] = chainAsset.split('.')
  const toChain = THOR_MEMO_CHAIN_TO_ENUM[destChainCode]
  if (!toChain) {
    throw new VaultError(
      VaultErrorCode.UnsupportedChain,
      `parseThorSwapMemo: unsupported destination chain code '${destChainCode}' in memo '${memo}'.`
    )
  }

  const destAsset = destAssetRaw?.split('-')[0] ?? ''
  const destAddress = typeof parts[1] === 'string' ? parts[1] : ''

  return { destChainCode, destAsset, destAddress, toChain }
}
