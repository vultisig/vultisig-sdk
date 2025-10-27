import { Chain } from '../../../Chain'

export const kyberSwapEnabledChains = [
  Chain.Ethereum,
  Chain.BSC,
  Chain.Arbitrum,
  Chain.Polygon,
  Chain.Optimism,
  Chain.Avalanche,
  Chain.Base,
  Chain.Zksync,
  Chain.Blast,
] as const

export type KyberSwapEnabledChain = (typeof kyberSwapEnabledChains)[number]
