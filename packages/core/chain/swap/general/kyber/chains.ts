import { Chain } from '@vultisig/core-chain/Chain'

// Zksync is intentionally absent (sdk#1151): Kyber's
// aggregator-api.kyberswap.com /routes endpoint 404s on it (verified
// 2026-07-08, see knownAggregatorRouters.ts) — listing it only burned a
// doomed fetch + timeout slot per quote on that chain. Re-add if Kyber's
// API starts serving it.
export const kyberSwapEnabledChains = [
  Chain.Ethereum,
  Chain.BSC,
  Chain.Arbitrum,
  Chain.Polygon,
  Chain.Optimism,
  Chain.Avalanche,
  Chain.Base,
  Chain.Robinhood,
] as const

export type KyberSwapEnabledChain = (typeof kyberSwapEnabledChains)[number]
