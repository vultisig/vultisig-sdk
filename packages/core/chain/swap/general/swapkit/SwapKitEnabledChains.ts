import { Chain } from '@vultisig/core-chain/Chain'

export const swapKitSourceChains = [
  Chain.Ethereum,
  Chain.Arbitrum,
  Chain.Avalanche,
  Chain.Base,
  Chain.BSC,
  Chain.Optimism,
  Chain.Polygon,
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

export type SwapKitSourceChain = (typeof swapKitSourceChains)[number]

export const swapKitEnabledChains = [
  ...swapKitSourceChains,
  Chain.Cosmos,
  Chain.Dash,
  Chain.MayaChain,
  Chain.THORChain,
] as const

export type SwapKitEnabledChain = (typeof swapKitEnabledChains)[number]
