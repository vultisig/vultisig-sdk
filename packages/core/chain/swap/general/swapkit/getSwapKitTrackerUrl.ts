import { Chain } from '../../../Chain'
import type { SwapKitEnabledChain } from './SwapKitEnabledChains'

/**
 * Chain identifiers accepted by SwapKit's public tracker.
 *
 * Keep this mapping aligned with the shipping iOS and Android tracker builders.
 * The `Record<SwapKitEnabledChain, string>` constraint makes a newly enabled
 * SwapKit chain a compile-time update instead of a silent tracking regression.
 */
export const swapKitTrackerChainIds = {
  [Chain.Ethereum]: '1',
  [Chain.Arbitrum]: '42161',
  [Chain.Avalanche]: '43114',
  [Chain.Base]: '8453',
  [Chain.BSC]: '56',
  [Chain.Polygon]: '137',
  [Chain.Optimism]: '10',
  [Chain.Blast]: '81457',
  [Chain.Zksync]: '324',
  [Chain.Tron]: '728126428',
  [Chain.Cardano]: 'cardano',
  [Chain.Ton]: 'ton',
  [Chain.Solana]: 'solana',
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoincash',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Ripple]: 'ripple',
  [Chain.Cosmos]: 'cosmoshub-4',
  [Chain.Dash]: 'dash',
  [Chain.Zcash]: 'zcash',
  [Chain.Sui]: 'sui',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Kujira]: 'kaiyo-1',
  [Chain.MayaChain]: 'mayachain-mainnet-v1',
  [Chain.THORChain]: 'thorchain-1',
} as const satisfies Record<SwapKitEnabledChain, string> & Partial<Record<Chain, string>>

type GetSwapKitTrackerUrlInput = {
  chain: Chain
  txHash: string
}

/** Resolve a SwapKit public tracker URL, or null for a chain the tracker does not support. */
export const getSwapKitTrackerUrl = ({ chain, txHash }: GetSwapKitTrackerUrlInput): string | null => {
  const chainId = (swapKitTrackerChainIds as Partial<Record<Chain, string>>)[chain]
  if (!chainId) return null

  const searchParams = new URLSearchParams({
    hash: txHash,
    chainId,
  })

  return `https://track.swapkit.dev/?${searchParams.toString()}`
}
