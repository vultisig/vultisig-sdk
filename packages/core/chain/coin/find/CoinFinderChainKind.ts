export const coinFinderChainKinds = ['evm', 'cosmos', 'solana', 'cardano', 'ripple'] as const
export type CoinFinderChainKind = (typeof coinFinderChainKinds)[number]
