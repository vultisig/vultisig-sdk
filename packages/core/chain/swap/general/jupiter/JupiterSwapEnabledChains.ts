import { Chain } from '@vultisig/core-chain/Chain'

/**
 * Jupiter is a Solana-only, same-chain aggregator. It can route SOL↔SPL and
 * SPL↔SPL pairs that stay on Solana, and nothing else — there is no cross-chain
 * Jupiter route. `findSwapQuote` therefore only offers Jupiter when both legs
 * are on Solana.
 */
export const jupiterSwapEnabledChains = [Chain.Solana] as const

export type JupiterSwapEnabledChain = (typeof jupiterSwapEnabledChains)[number]
