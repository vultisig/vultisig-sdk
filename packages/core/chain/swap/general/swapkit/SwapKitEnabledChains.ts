import { Chain } from '@vultisig/core-chain/Chain'

// Chains that can be the SOURCE of a SwapKit-routed swap.
// Live curl matrix against the vultisig.com proxy confirms NEAR Intents +
// THORChain via SwapKit accept these as source: BTC, ZEC, LTC, DOGE, BCH,
// DASH, Cosmos, THORChain, MayaChain, Ton, Cardano, Sui, Tron, Ripple, Kujira.
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
  Chain.Cardano,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Dogecoin,
  Chain.Kujira,
  Chain.Litecoin,
  Chain.MayaChain,
  Chain.Ripple,
  Chain.Sui,
  Chain.THORChain,
  Chain.Ton,
  Chain.Tron,
  Chain.Zcash,
] as const

export type SwapKitSourceChain = (typeof swapKitSourceChains)[number]

// Chains that can be the DESTINATION of a SwapKit-routed swap.
// Currently identical content to swapKitSourceChains but kept as a separate
// const + type so consumers can narrow on source-only behavior in the future
// without silently colliding with destination-only checks (per NeO CR
// preferably-blocking 1 on sdk#514).
export const swapKitEnabledChains = [
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
  Chain.Cardano,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Dogecoin,
  Chain.Kujira,
  Chain.Litecoin,
  Chain.MayaChain,
  Chain.Ripple,
  Chain.Sui,
  Chain.THORChain,
  Chain.Ton,
  Chain.Tron,
  Chain.Zcash,
] as const

export type SwapKitEnabledChain = (typeof swapKitEnabledChains)[number]
