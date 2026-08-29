import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { blockaidEvmChain, BlockaidSupportedEvmChain } from '@vultisig/core-chain/security/blockaid/evmChains'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

export const swapKitSourceChains = [
  Chain.Ethereum,
  Chain.Arbitrum,
  Chain.Avalanche,
  Chain.Base,
  Chain.BSC,
  Chain.Optimism,
  Chain.Polygon,
  Chain.Hyperliquid,
  Chain.Solana,
  Chain.Bitcoin,
  Chain.BitcoinCash,
  Chain.Dogecoin,
  Chain.Litecoin,
  Chain.Ripple,
  Chain.Ton,
  Chain.Tron,
  Chain.Zcash,
  // Sui + Cardano confirmed live as SOURCE via SwapKit's NEAR-Intents provider
  // (SUI.SUI->ETH.ETH, SUI.SUI->BTC.BTC, ADA.ADA->ETH.ETH all returned real
  // routes). Dest direction already worked (both were already in
  // swapKitEnabledChains below).
  //
  // Sui is wired end-to-end: SwapKit's pre-built PTB rides the `transfer` arm
  // as `txType: 'SUI'` + `txPayload`, and `buildSwapKeysignPayload` hands those
  // bytes to the existing `signSui` signing path.
  Chain.Sui,
  // Cardano is type-level source eligibility ONLY — `getSwapKitQuote` still
  // rejects it as a source before any network call, because there is no CBOR
  // decode for its payload yet (see that file's
  // `SWAP_SOURCE_TX_BUILD_UNSUPPORTED` guard).
  Chain.Cardano,
] as const

export type SwapKitSourceChain = (typeof swapKitSourceChains)[number] | BlockaidSupportedEvmChain

export const swapKitEnabledChains = [
  ...swapKitSourceChains,
  Chain.Robinhood,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Kujira,
  Chain.MayaChain,
  Chain.THORChain,
] as const

export type SwapKitEnabledChain = (typeof swapKitEnabledChains)[number]

/**
 * Source-side eligibility is deliberately stricter than destination support.
 * Existing non-EVM transaction builders stay explicitly listed, while EVM
 * chains may be discovered from SwapKit's live catalog only when the SDK can
 * screen their returned router through Blockaid. This keeps Robinhood
 * destination-only until Blockaid adds chain 4663 without closing future safe
 * EVM corridors behind another SwapKit allowlist change.
 */
export const isSwapKitSourceChain = (chain: Chain): chain is SwapKitSourceChain =>
  isOneOf(chain, swapKitSourceChains) || (isChainOfKind(chain, 'evm') && chain in blockaidEvmChain)
