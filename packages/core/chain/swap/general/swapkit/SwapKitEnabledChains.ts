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
] as const

export type SwapKitSourceChain = (typeof swapKitSourceChains)[number]

export const swapKitEnabledChains = [
  ...swapKitSourceChains,
  Chain.Cardano,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Kujira,
  Chain.MayaChain,
  Chain.Sui,
  Chain.THORChain,
] as const

export type SwapKitEnabledChain = (typeof swapKitEnabledChains)[number]
