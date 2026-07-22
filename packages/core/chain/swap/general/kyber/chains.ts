import { Chain } from '@vultisig/core-chain/Chain'

// Zksync and Blast are intentionally absent (sdk#1151): Kyber's
// aggregator-api.kyberswap.com /routes endpoint 404s on both (verified
// 2026-07-08, see knownAggregatorRouters.ts) — listing them only burned a
// doomed fetch + timeout slot per quote on those chains. Re-add if Kyber's
// API starts serving them.
export const kyberSwapEnabledChains = [
  Chain.Ethereum,
  Chain.BSC,
  Chain.Arbitrum,
  Chain.Polygon,
  Chain.Optimism,
  Chain.Avalanche,
  Chain.Base,
] as const

export type KyberSwapEnabledChain = (typeof kyberSwapEnabledChains)[number]
