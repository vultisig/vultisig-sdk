import { Chain } from '@vultisig/core-chain/Chain'

export const jupiterSwapEnabledChains = [Chain.Solana] as const

export type JupiterSwapEnabledChain = (typeof jupiterSwapEnabledChains)[number]
