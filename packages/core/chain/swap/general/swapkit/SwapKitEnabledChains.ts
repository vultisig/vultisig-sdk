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
  // swapKitEnabledChains below). NOTE: type-level source eligibility only —
  // `getSwapKitQuote` (getSwapKitQuote.ts) explicitly rejects these two as a
  // source with a clear error before making any network call, since neither
  // has a wired tx-build/decode path yet (see that file's
  // `SWAP_SOURCE_TX_BUILD_UNSUPPORTED` guard for the full explanation). Signing
  // support is separate follow-on work, not covered by this change.
  Chain.Sui,
  Chain.Cardano,
] as const

export type SwapKitSourceChain = (typeof swapKitSourceChains)[number]

export const swapKitEnabledChains = [
  ...swapKitSourceChains,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Kujira,
  Chain.MayaChain,
  Chain.THORChain,
] as const

export type SwapKitEnabledChain = (typeof swapKitEnabledChains)[number]
