import { Chain } from '@vultisig/core-chain/Chain'

export const oneInchSwapEnabledChains = [
  Chain.Ethereum,
  Chain.Arbitrum,
  Chain.Zksync,
  Chain.BSC,
  Chain.Avalanche,
  Chain.Optimism,
  Chain.Polygon,
  Chain.Base,
  // Live-confirmed on 4663: /quote and /swap return executable calldata to
  // 1inch's deployed router (0x5a70…89c7).
  Chain.Robinhood,
] as const
