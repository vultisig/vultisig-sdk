export const coinFinderChainKinds = ['evm', 'cosmos', 'solana', 'cardano', 'ripple', 'ton'] as const
export type CoinFinderChainKind = (typeof coinFinderChainKinds)[number]
